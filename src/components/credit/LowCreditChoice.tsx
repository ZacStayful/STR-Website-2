"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { formatGbp, notifyCreditChanged } from "@/lib/credit/client";
import { useCreditOptional, type CreditSnapshot } from "./CreditProvider";
import { StarterConfirm } from "./StarterConfirm";

const money = (p: number) => (p % 100 === 0 ? `£${Math.round(p / 100)}` : formatGbp(p));

/**
 * Batch 20, Part B: the banner for a member with no plan at £5 or less
 * (£0 included): Starter or a £10 top-up. "Start Starter" opens a small
 * sheet that says what it costs before anything is charged; the top-up is
 * one tap on a saved card, as every top-up button is (else Stripe Checkout).
 */
export function LowCreditChoice({ credit }: { credit: CreditSnapshot }) {
  const ctx = useCreditOptional();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decision = credit.decision!;
  const starter = decision.starter;
  const out = credit.state === "out";
  const colour = out ? "#991b1b" : "#b45309";

  async function topUp() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPence: decision.topupPence, nonce: crypto.randomUUID(), via: "low_credit" }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't complete the top-up.");
        return;
      }
      notifyCreditChanged();
      ctx?.toast(`Topped up ${money(decision.topupPence)}`);
    } catch {
      setError("Couldn't reach the billing service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-40 w-full border-b border-black/10 shadow-sm" style={{ backgroundColor: colour }}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2.5 text-center text-sm font-medium text-white">
        <span>
          {out ? "You’re out of credit." : `You have ${formatGbp(Math.max(0, credit.totalPence))} of credit left.`}
          {starter ? ` ${starter.name} gives you ${money(starter.creditPence)} of credit every month for ${money(starter.pricePence)} a month.` : ""}
        </span>
        <span className="flex gap-2">
          {starter ? (
            <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-white/90" style={{ color: colour }}>
              Start {starter.name}
            </button>
          ) : null}
          <button type="button" onClick={() => void topUp()} disabled={busy} className="inline-flex items-center rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/25 disabled:opacity-60">
            {busy ? "Working…" : `Top up ${money(decision.topupPence)}`}
          </button>
        </span>
        {error ? <span className="w-full text-xs text-white/90">{error}</span> : null}
      </div>
      {starter ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
            <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background p-6 text-left shadow-2xl">
              <div className="mb-3 flex items-start justify-between gap-4">
                <Dialog.Title className="text-lg font-semibold text-foreground">Start {starter.name}</Dialog.Title>
                <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              {open ? <StarterConfirm plan={starter} returnTo={pathname || "/today"} onDone={() => setOpen(false)} /> : null}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
