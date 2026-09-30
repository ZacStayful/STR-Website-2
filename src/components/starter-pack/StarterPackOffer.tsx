'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { notifyCreditChanged } from '@/lib/credit/client';
import type { PackCopy } from '@/lib/starter-pack/rules';

/**
 * The £10 starter pack's buy box (Batch 20): what it gives, the unticked
 * consent tickbox the UK's digital-content rules call for, and Buy, which is
 * only live once it is ticked. One click on a saved card; otherwise Stripe
 * Checkout. The same box is used on the welcome screen, the Today card, the
 * Account line and wherever a member without credit would otherwise hit a
 * dead end.
 */
export function StarterPackOffer({
  copy,
  returnTo,
  onNotNow,
  notNowLabel,
  variant = 'card',
  heading = true,
  onContinue,
  continueLabel,
}: {
  copy: PackCopy;
  returnTo: string;
  onNotNow?: () => void;
  notNowLabel?: string;
  variant?: 'screen' | 'card' | 'compact';
  heading?: boolean;
  /** After a one-click purchase: the way on (the welcome screen's next question). */
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per attempt: a double tap is the same payment; a retry after an error is a new one.
  const [nonce, setNonce] = useState(() => crypto.randomUUID());

  const buy = async () => {
    if (!ticked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/starter-pack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: true, nonce, returnTo }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; ok?: boolean; pending?: boolean; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.ok) {
        setDone(data.pending ? `Your payment went through: your ${copy.credit} of credit will be on your account within a few minutes. It never expires.` : `${copy.credit} of credit is on your account. It never expires.`);
        notifyCreditChanged();
        router.refresh();
        return;
      }
      setError(data.error ?? 'Something went wrong. Nothing was charged.');
      setNonce(crypto.randomUUID());
    } catch {
      setError('Something went wrong. Nothing was charged.');
      setNonce(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div>
        <p className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" role="status">
          {done}
        </p>
        {onContinue ? (
          <button type="button" onClick={onContinue} className="mt-3 min-h-12 w-full rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted">
            {continueLabel ?? 'Continue'}
          </button>
        ) : null}
      </div>
    );
  }

  const big = variant === 'screen';
  return (
    <div>
      {heading ? (
        big ? (
          <>
            <h1 className="text-2xl font-semibold text-foreground">{copy.headline}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-foreground">{copy.cardTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.cardBody}</p>
          </>
        )
      ) : null}
      <label className={`${heading ? 'mt-4' : ''} flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm text-foreground`}>
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={ticked} onChange={(e) => setTicked(e.target.checked)} disabled={busy} />
        <span>{copy.consent}</span>
      </label>
      <div className={`mt-3 flex ${big ? 'flex-col gap-3' : 'flex-wrap items-center gap-3'}`}>
        <button
          type="button"
          onClick={buy}
          disabled={!ticked || busy}
          className={`${big ? 'min-h-12 w-full' : 'min-h-10 px-4'} rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50`}
        >
          {busy ? 'Working…' : variant === 'screen' ? copy.buy : copy.cardCta}
        </button>
        {onNotNow ? (
          <button type="button" onClick={onNotNow} disabled={busy} className={`${big ? 'min-h-12 w-full border border-border' : 'min-h-10 px-3'} rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50`}>
            {notNowLabel ?? copy.notNow}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">{copy.smallPrint}</p>
    </div>
  );
}
