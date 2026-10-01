"use client";

import { useState } from "react";
import { formatPence } from "@/lib/credit/deal-pricing";
import { notifyCreditChanged } from "@/lib/credit/client";
import { useCreditOptional } from "@/components/credit/CreditProvider";

/**
 * Batch 22, Part H: after the reports, when the balance is low, the in-view
 * alternative to a low-credit call: "Turn on auto top-up". Needs a saved
 * card; without one, the top-up window instead. Nothing here schedules or
 * triggers a call (Batch 23's rule: no low-credit call in a member's first
 * 3 days).
 */
export function AutoTopupOffer({ amountPence, thresholdPence }: { amountPence: number; thresholdPence: number }) {
  const credit = useCreditOptional();
  const snap = credit?.credit;
  const [state, setState] = useState<"idle" | "busy" | "on" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!snap || snap.member || snap.admin) return null;
  if (snap.autoTopup?.amountPence) return null;
  if (snap.totalPence >= thresholdPence && state !== "on") return null;
  if (state === "on") return <p role="status" className="rounded-xl bg-white/5 p-4 text-sm text-[#B9D5C6]">Auto top-up is on.</p>;
  return (
    <div className="rounded-xl bg-white/5 p-4 text-sm text-white">
      <p>
        Turn on auto top-up: {formatPence(amountPence)} when you drop below {formatPence(thresholdPence)}.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-xs text-[#f3c1bd]">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={state === "busy"}
        className="mt-3 rounded-md bg-[#B9D5C6] px-3 py-1.5 text-xs font-semibold text-[#1a2118] hover:opacity-90 disabled:opacity-50"
        onClick={async () => {
          if (!snap.hasSavedCard) {
            credit?.openOutOfCredit({ mode: "topup" });
            return;
          }
          setState("busy");
          const r = await fetch("/api/billing/auto-topup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amountPence, thresholdPence }) }).catch(() => null);
          const body = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
          if (r?.ok) {
            setState("on");
            notifyCreditChanged();
          } else {
            setState("error");
            setError(body?.error ?? "That didn’t save. Please try again.");
          }
        }}
      >
        {snap.hasSavedCard ? "Turn on auto top-up" : "Top up first"}
      </button>
    </div>
  );
}
