"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { ACTION_LABELS, fetchEstimate, formatGbp, type EstimateResponse, type OutOfCreditDetail } from "@/lib/credit/client";
import { useCreditOptional } from "./CreditProvider";
import { TopupButtons } from "./TopupButtons";
import { RateComparison } from "./RateComparison";
import { StarterPackOffer } from "@/components/starter-pack/StarterPackOffer";
import { packNotNowAction, packShownAction } from "@/components/starter-pack/actions";
import type { PackCopy } from "@/lib/starter-pack/rules";

/**
 * The blocking out-of-credit dialog: what was needed, what's left, then two
 * ways forward — upgrade (primary, spends at the plan rate) or a one-click
 * top-up (spends at the top-up rate, 1.3× by default). A new member who can
 * still buy the starter pack is offered that instead (Batch 20).
 */
export function OutOfCreditModal({ detail, onClose }: { detail: OutOfCreditDetail | null; onClose: () => void }) {
  const credit = useCreditOptional();
  const [busy, setBusy] = useState(false);
  const [reportEst, setReportEst] = useState<EstimateResponse | null>(null);
  const open = detail !== null;
  // The pack as it was when the dialog opened: buying it refreshes the balance, and the dialog must not change under them.
  const [packFor, setPackFor] = useState<{ detail: OutOfCreditDetail | null; pack: PackCopy | null }>({ detail: null, pack: null });
  if (packFor.detail !== detail) setPackFor({ detail, pack: detail && !credit?.credit?.member ? (credit?.credit?.pack ?? null) : null });
  const pack = packFor.detail === detail ? packFor.pack : null;

  useEffect(() => {
    if (open && pack) packShownAction("modal").catch(() => {});
  }, [open, pack]);

  useEffect(() => {
    if (!open || pack) return;
    let alive = true;
    void fetchEstimate("report").then((e) => {
      if (alive) setReportEst(e);
    });
    return () => {
      alive = false;
    };
  }, [open, pack]);

  const snapshot = credit?.credit ?? null;
  const presets = snapshot?.topupPresetsPence ?? [1000, 2500, 5000];
  const hasSavedCard = snapshot?.hasSavedCard ?? false;
  const available = detail?.availablePence ?? snapshot?.totalPence ?? 0;
  const actionLabel = detail?.action ? ACTION_LABELS[detail.action] ?? detail.action : null;
  const topupMode = detail?.mode === "topup";

  const member = snapshot?.member ?? null;
  const title = member?.paused
    ? "Your seat is paused"
    : topupMode ? (pack ? pack.headline : "Top up your credit") : available <= 0 ? "You're out of credit" : "Not enough credit for this";
  const body = topupMode
    ? `You have ${formatGbp(available)} of credit left.`
    : detail?.requiredPence
      ? `This ${actionLabel ?? "action"} needs up to ${formatGbp(detail.requiredPence)} of credit and you have ${formatGbp(available)}.`
      : `You have ${formatGbp(available)} of credit left. Upgrade or top up to keep going.`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background p-6 shadow-2xl transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-foreground">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">{body}</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Close" disabled={busy}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {pack && !member ? (
            <div className="mt-5 space-y-3">
              <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <StarterPackOffer
                  copy={pack}
                  returnTo={typeof window === "undefined" ? "/today" : `${window.location.pathname}${window.location.search}`}
                  variant="card"
                  onNotNow={() => {
                    packNotNowAction("modal").catch(() => {});
                    onClose();
                  }}
                  onContinue={onClose}
                  continueLabel="Carry on"
                />
              </section>
              <p className="text-center text-xs text-muted-foreground">
                Or{" "}
                <Link href="/upgrade" className="font-medium text-foreground underline underline-offset-4" onClick={onClose}>
                  choose a plan
                </Link>
                .
              </p>
            </div>
          ) : member ? (
            // A team member spends the owner's credit and cannot buy more.
            <p className="mt-5 rounded-xl border border-border p-4 text-sm text-muted-foreground">
              {member.paused
                ? `Your seat on ${member.teamName} couldn't be renewed. It comes back as soon as the account owner tops up.`
                : `${member.teamName}'s credit is paid for by the account owner. Ask them to top up, then try again.`}
            </p>
          ) : (
          <div className="mt-5 space-y-4">
            <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold text-foreground">Upgrade your plan</h3>
              <p className="mt-1 text-xs text-muted-foreground">Monthly credit at the standard rate, renewed every month. The best value if you run reports regularly.</p>
              <Link href="/upgrade" className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90" onClick={onClose}>
                See plans
              </Link>
            </section>

            <section className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Or top up now</h3>
              <p className="mt-1 text-xs text-muted-foreground">Top-up credit never expires but is spent at {snapshot?.rates.topup ?? 1.5}× the subscription rate.</p>
              <div className="mt-3">
                <TopupButtons
                  presets={presets}
                  hasSavedCard={hasSavedCard}
                  autoFocusFirst={topupMode}
                  resumeId={detail?.resumeId}
                  onDone={() => {
                    setBusy(false);
                    onClose();
                  }}
                />
              </div>
            </section>

            <RateComparison estimate={reportEst} presets={presets} />
          </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
