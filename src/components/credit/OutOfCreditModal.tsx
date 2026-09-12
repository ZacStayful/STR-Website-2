"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { ACTION_LABELS, fetchEstimate, formatGbp, type EstimateResponse, type OutOfCreditDetail } from "@/lib/credit/client";
import { useCreditOptional } from "./CreditProvider";
import { TopupButtons } from "./TopupButtons";
import { RateComparison } from "./RateComparison";

/**
 * The blocking out-of-credit dialog: what was needed, what's left, then two
 * ways forward — upgrade (primary, spends at the plan rate) or a one-click
 * top-up (spends at 1.5×).
 */
export function OutOfCreditModal({ detail, onClose }: { detail: OutOfCreditDetail | null; onClose: () => void }) {
  const credit = useCreditOptional();
  const [busy, setBusy] = useState(false);
  const [reportEst, setReportEst] = useState<EstimateResponse | null>(null);
  const open = detail !== null;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchEstimate("report").then((e) => {
      if (alive) setReportEst(e);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const snapshot = credit?.credit ?? null;
  const presets = snapshot?.topupPresetsPence ?? [1000, 2500, 5000];
  const hasSavedCard = snapshot?.hasSavedCard ?? false;
  const available = detail?.availablePence ?? snapshot?.totalPence ?? 0;
  const actionLabel = detail?.action ? ACTION_LABELS[detail.action] ?? detail.action : null;
  const topupMode = detail?.mode === "topup";

  const title = topupMode ? "Top up your credit" : available <= 0 ? "You're out of credit" : "Not enough credit for this";
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
                  onDone={() => {
                    setBusy(false);
                    onClose();
                  }}
                />
              </div>
            </section>

            <RateComparison estimate={reportEst} presets={presets} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
