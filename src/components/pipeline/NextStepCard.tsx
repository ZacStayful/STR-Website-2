"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextStepView, OfferView } from "@/lib/pipeline/view";
import { formatAmount, parseAmount, withOfferAmount } from "@/lib/pipeline/offer-amount";
import { trackStepAction } from "@/app/my-deals/next-step-actions";
import { MessageBox } from "./MessageBox";
import { Checklist } from "./Checklist";
import { ManageEnquiry } from "./ManageEnquiry";
import { MoveButton } from "./MoveButton";

/**
 * The next step for one deal (Batch 7), drawn from a finished view built on
 * the server (src/lib/pipeline/view.ts). On My deals it sits folded under
 * the deal ("Next step: Contact the agent"); on the deal page it is open.
 */
export function NextStepCard({ view, variant }: { view: NextStepView; variant: "compact" | "full" }) {
  const [amountText, setAmountText] = useState(view.offer?.initialAmount != null ? formatAmount(view.offer.initialAmount) : "");
  const amount = parseAmount(amountText);
  const move = view.move ? <MoveButton itemKey={view.itemKey} stage={view.stage} kind={view.kind} label={view.move.label} /> : null;

  // Passed: only the way back.
  if (view.heading === null) return move ? <div className="mt-3">{move}</div> : null;

  const m = view.message;
  const subject = m ? (m.withAmount ? withOfferAmount({ withAmount: m.withAmount.subject, without: m.subject }, amount) : m.subject) : "";
  const body = m ? (m.withAmount ? withOfferAmount({ withAmount: m.withAmount.body, without: m.body }, amount) : m.body) : "";
  const track = (action: "copy" | "email") => {
    if (m) void trackStepAction(view.itemKey, view.stage, view.kind, action, m.id).catch(() => undefined);
  };

  const content = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{view.intro}</p>
      {view.warning && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-foreground">{view.warning}</p>}
      {view.offer && <OfferPanel offer={view.offer} amountText={amountText} onAmount={setAmountText} showAmount={Boolean(m?.withAmount)} />}
      {m && <MessageBox subject={subject} body={body} labels={view.labels} onCopy={() => track("copy")} onEmail={() => track("email")} />}
      {view.checklist && (view.stage === "viewing" || view.stage === "secured") && <Checklist itemKey={view.itemKey} stage={view.stage} kind={view.kind} items={view.checklist} />}
      {move}
      {view.manage && <ManageEnquiry view={view.manage} itemKey={view.itemKey} kind={view.kind} />}
    </div>
  );

  if (variant === "compact") {
    return (
      <details className="group mt-3 rounded-lg border border-border bg-muted/30">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">
          <span className="text-muted-foreground">{view.labels.showStep}</span> {view.heading}
        </summary>
        <div className="px-3 pb-3">{content}</div>
      </details>
    );
  }
  return (
    <section className="mt-4 rounded-lg border border-border bg-muted/30 p-3" aria-label="Next step">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{view.labels.showStep}</p>
      <h2 className="text-base font-semibold text-foreground">{view.heading}</h2>
      <div className="mt-2">{content}</div>
    </section>
  );
}

function OfferPanel({ offer, amountText, onAmount, showAmount }: { offer: OfferView; amountText: string; onAmount: (v: string) => void; showAmount: boolean }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{offer.title}</p>
      {offer.figure && <p className="text-lg font-bold text-foreground">{offer.figure}</p>}
      {offer.working && <p className="text-xs text-foreground">{offer.working}</p>}
      {offer.notes.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">{n}</p>
      ))}
      {offer.goalsLink && (
        <Link href={offer.goalsLink.href} className="inline-block text-xs font-medium text-primary hover:underline">
          {offer.goalsLink.text}
        </Link>
      )}
      {offer.disclaimer && <p className="text-[11px] text-muted-foreground">{offer.disclaimer}</p>}
      {showAmount && (
        <label className="block space-y-1 pt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{offer.amountLabel}</span>
          <input value={amountText} onChange={(e) => onAmount(e.target.value)} inputMode="numeric" placeholder="£" className="block w-40 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          <span className="block">{offer.amountHelp}</span>
        </label>
      )}
    </div>
  );
}
