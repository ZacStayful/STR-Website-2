"use client";

import { useState } from "react";
import Link from "next/link";
import { creditFetch, notifyCreditChanged, openOutOfCredit } from "@/lib/credit/client";
import { priceText, type PriceLabel } from "@/lib/credit/deal-pricing";

/**
 * Buying a Full analysis of a deal (Batch 10): what you get, a sample, the
 * optional PMI second opinion (never pre-ticked), this member's price, and
 * one Confirm. Confirming starts the purchase (/api/deals/[id]/analysis),
 * then streams the run (/api/deals/[id]/analysis/run) and lands on the
 * finished report. The price sent back is the one on screen: a changed
 * price is refused by the server, never charged.
 */
export interface AnalysisPanelProps {
  dealId: string;
  /** Opened straight away (?analysis=1, from a card). */
  initialOpen: boolean;
  /** Why it cannot run (no full postcode, no rent), when it cannot. */
  blocked: string | null;
  /** The price without and with PMI, at this member's rates. */
  price: { without: PriceLabel; withPmi: PriceLabel };
  /** "+£2" (or "+£2.60 · £2 on a plan") for the PMI line: what ticking it adds for this member (addOnLabel). Null when PMI is switched off. */
  pmi: PriceLabel | null;
  /** The deal is not open to them yet: the purchase opens it first (the Quick look is part of the price). */
  opensDeal: boolean;
  /** Recommend PMI (the deal is at Offer). The box is still never ticked for them. */
  recommendPmi?: boolean;
  sampleHref: string;
  /** Where the button sits: a full-width primary action, or an inline one. */
  variant?: "primary" | "inline";
  /** The reminder the member came from (?from=), recorded when they start the analysis. */
  from?: "stage" | "kept_step" | null;
}

const WHAT_YOU_GET = [
  "Nearby short-let listings like it, with their nightly rates and occupancy",
  "12 months of occupancy, nightly rate and income for this property",
  "Its costs: bills, council tax, stamp duty and the mortgage at your finance",
  "The long-let comparison: what it would make on a normal tenancy",
  "Due diligence: flood risk, EPC, planning designations and listed buildings",
  "Demand: transport, universities, hospitals and events nearby",
  "A risk score and a verdict",
  "A PDF to keep or share",
];

type Phase = { kind: "idle" } | { kind: "starting" } | { kind: "running"; progress: number; message: string } | { kind: "error"; message: string };

export function AnalysisPanel({ dealId, initialOpen, blocked, price, pmi, opensDeal, recommendPmi = false, sampleHref, variant = "primary", from = null }: AnalysisPanelProps) {
  const [open, setOpen] = useState(initialOpen);
  const [withPmi, setWithPmi] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const label = withPmi && pmi ? price.withPmi : price.without;
  const text = priceText(label);
  const busy = phase.kind === "starting" || phase.kind === "running";

  async function confirm() {
    if (busy || blocked) return;
    // Batch 21 (B5): "Top up to run it" opens the top-up dialog. It never starts
    // the run, which in shadow mode went ahead and debited into overdraft.
    if (label.state === "short") {
      openOutOfCredit({ action: "full_analysis", requiredPence: label.basePence, mode: "topup" });
      return;
    }
    setPhase({ kind: "starting" });
    // Set once the purchase has started: from then on a lost connection may
    // have left a Quick look charged (a one-tap opens the deal first).
    let started: { purchaseId?: string; openedNow?: boolean } | null = null;
    try {
      const start = await creditFetch(`/api/deals/${encodeURIComponent(dealId)}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withPmi: withPmi && Boolean(pmi), ...(label.state === "admin" ? { quotedBasePence: 0 } : { quotedBasePence: label.basePence, quotedFacePence: label.facePence }), ...(from ? { from } : {}) }),
      });
      const answer = (await start.json().catch(() => ({}))) as { purchaseId?: string; openedNow?: boolean; error?: string; code?: string; reportId?: string };
      if (!start.ok || !answer.purchaseId) {
        if (answer.reportId) {
          window.location.assign(`/reports/${encodeURIComponent(answer.reportId)}?back=${encodeURIComponent(`/deals/${dealId}`)}`);
          return;
        }
        setPhase({ kind: "error", message: answer.error ?? "Something went wrong. Nothing was charged; please try again." });
        // A new price (or a deal opened on the way) needs the page's own prices. Not for
        // insufficient credit (Batch 20): the reload closed the out-of-credit dialog it opened.
        if (answer.code === "price_changed") setTimeout(() => window.location.reload(), 3000);
        return;
      }
      started = answer;
      notifyCreditChanged();
      setPhase({ kind: "running", progress: 5, message: "Starting your Full analysis…" });
      const run = await fetch(`/api/deals/${encodeURIComponent(dealId)}/analysis/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: answer.purchaseId }),
      });
      if (!run.ok || !run.body) {
        const data = (await run.json().catch(() => ({}))) as { error?: string; reportId?: string };
        if (data.reportId) {
          window.location.assign(`/reports/${encodeURIComponent(data.reportId)}?back=${encodeURIComponent(`/deals/${dealId}`)}`);
          return;
        }
        setPhase({ kind: "error", message: data.error ?? "Something went wrong running the Full analysis. You haven’t been charged for it; please try again." });
        return;
      }
      const reader = run.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: { stage?: string; progress?: number; message?: string; reportId?: string };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.stage === "error") {
            notifyCreditChanged();
            setPhase({ kind: "error", message: event.message ?? "The Full analysis couldn’t be completed. You haven’t been charged for it." });
            return;
          }
          if (event.stage === "complete" && event.reportId) {
            notifyCreditChanged();
            window.location.assign(`/reports/${encodeURIComponent(event.reportId)}?back=${encodeURIComponent(`/deals/${dealId}`)}`);
            return;
          }
          setPhase({ kind: "running", progress: Math.max(5, Math.min(99, Number(event.progress) || 5)), message: event.message ?? "Working…" });
        }
      }
      // The stream ended without a result: the run still finishes on the server.
      setPhase({ kind: "error", message: "We lost the connection, but your Full analysis carries on. Refresh this page in a minute to open it." });
    } catch {
      setPhase({
        kind: "error",
        message: !started
          ? "We couldn’t reach the server. Nothing was charged; please try again."
          : started.openedNow
            ? "We lost the connection. The Full analysis hasn’t been charged unless it finished (refresh to see); the Quick look it opened stays yours. Please try again."
            : "We lost the connection. The Full analysis hasn’t been charged unless it finished: refresh this page to see, or try again.",
      });
    }
  }

  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={variant === "primary" ? "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90" : "rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"}
      aria-expanded={open}
    >
      Full analysis{priceText(price.without) ? ` · ${priceText(price.without)}` : ""}
    </button>
  );

  return (
    <div>
      {!open && toggle}
      {open && (
        <section className="mt-2 rounded-lg border border-primary/40 bg-card p-4" aria-label="Full analysis">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Full analysis of this property</h3>
            {!busy && (
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">
                Close
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The exact figures for this property, not the area estimate.{opensDeal ? " It includes the Quick look: the address, photos and listing link." : ""}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What you get</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground">
            {WHAT_YOU_GET.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            <Link href={sampleHref} target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">
              See a sample report
            </Link>
          </p>
          {blocked ? (
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground">{blocked}</p>
          ) : (
            <>
              {pmi && (
                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs text-foreground">
                  <input type="checkbox" className="mt-0.5" checked={withPmi} disabled={busy} onChange={(e) => setWithPmi(e.target.checked)} />
                  <span>
                    <span className="font-semibold">Make it a Deep report: add a second opinion from PMI · +{priceText(pmi)}.</span> {recommendPmi ? "Recommended now you’re making an offer." : "Recommended before you make an offer."} PMI’s month-by-month figures and comparables sit beside ours, in the report and the PDF.
                  </span>
                </label>
              )}
              {label.split && <p className="mt-2 text-[11px] text-muted-foreground">Paid as {label.split}.</p>}
              {phase.kind === "running" ? (
                <div className="mt-3" role="status" aria-live="polite">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${phase.progress}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{phase.message}</p>
                </div>
              ) : (
                <button type="button" onClick={confirm} disabled={busy} className="mt-3 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 sm:w-auto">
                  {phase.kind === "starting" ? "Starting…" : label.state === "short" ? `Top up to run it · ${label.main}` : `Run the Full analysis${text ? ` · ${text}` : ""}`}
                </button>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {opensDeal ? "The Quick look part is charged as the deal opens; the rest only once the analysis is complete." : "Charged only once the analysis is complete."} If it can’t get short-let figures for the property, the analysis isn’t charged.
              </p>
            </>
          )}
          {phase.kind === "error" && <p className="mt-2 text-xs text-destructive">{phase.message}</p>}
        </section>
      )}
    </div>
  );
}
