"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatGbp, notifyCreditChanged } from "@/lib/credit/client";

export interface StarterChoice {
  code: string;
  name: string;
  pricePence: number;
  creditPence: number;
}

const money = (p: number) => (p % 100 === 0 ? `£${Math.round(p / 100)}` : formatGbp(p));

/**
 * Batch 20, Part B: the last step before Starter is charged. It says the
 * price, the credit, that it renews monthly, the card it goes on, and the
 * terms, because with a saved card no Stripe page follows: one tap here
 * starts the plan. Without a saved card (or when Stripe needs the member,
 * as for 3-D Secure) it continues on Stripe Checkout.
 */
export function StarterConfirm({ plan, card: given, returnTo, onDone }: { plan: StarterChoice; card?: { brand: string; last4: string } | null; returnTo: string; onDone?: () => void }) {
  const [card, setCard] = useState<{ brand: string; last4: string } | null | undefined>(given);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // One key per attempt: a double tap is one subscription; a retry after an error is a new one.
  const [nonce, setNonce] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (given !== undefined) return;
    let alive = true;
    fetch("/api/billing/card", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { card?: { brand: string; last4: string } | null }) => {
        if (alive) setCard(d.card ?? null);
      })
      .catch(() => {
        if (alive) setCard(null);
      });
    return () => {
      alive = false;
    };
  }, [given]);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: plan.code, savedCard: Boolean(card), termsAccepted: true, nonce, via: "low_credit", returnTo }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.ok) {
        setDone(true);
        // The plan's credit follows Stripe's invoice in a moment.
        setTimeout(() => notifyCreditChanged(), 4000);
        return;
      }
      setError(data.error ?? "Couldn't start the plan. Nothing was charged.");
      setNonce(crypto.randomUUID());
    } catch {
      setError("Couldn't reach the billing service. Nothing was charged.");
      setNonce(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <p className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" role="status">
          {plan.name} is on. Your {money(plan.creditPence)} of credit arrives in a moment.
        </p>
        {onDone ? (
          <button type="button" onClick={onDone} className="mt-3 min-h-10 w-full rounded-lg border border-border text-sm font-semibold text-foreground hover:bg-muted">
            Done
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="text-base font-semibold text-foreground">
        {plan.name}: {money(plan.pricePence)} a month
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>{money(plan.creditPence)} of credit every month, and plan credit goes further than top-ups.</li>
        <li>Renews monthly until you cancel. Cancel any time from Billing.</li>
        <li>{card === undefined ? "Checking your saved card…" : card ? `On your card ending ${card.last4}.` : "You’ll add a card on Stripe’s secure page."}</li>
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        By starting {plan.name} you agree to our{" "}
        <Link href="/terms" className="underline underline-offset-4" target="_blank">
          Terms of service
        </Link>
        .
      </p>
      <button type="button" onClick={() => void start()} disabled={busy || card === undefined} className="mt-3 min-h-11 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
        {busy ? "Working…" : card ? `Start ${plan.name}: ${money(plan.pricePence)} a month` : `Continue to payment`}
      </button>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
