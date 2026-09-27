"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchEstimate, formatGbp, type EstimateResponse } from "@/lib/credit/client";

/**
 * "This report will use about £8.60 of your plan credit (up to £11.50)".
 * Worded by which bucket pays, and priced from the member's own grants at
 * each one's rate, so members on top-up credit see what they will actually
 * pay, the rate, and the nudge to upgrade.
 */
export function CostHint({ action, noun, className }: { action: "report" | "quick_view" | "narrate" | "speak"; noun?: string; className?: string }) {
  const [est, setEst] = useState<EstimateResponse | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchEstimate(action).then((e) => {
      if (alive) setEst(e);
    });
    return () => {
      alive = false;
    };
  }, [action]);
  if (!est) return null;
  if (est.admin) return <p className={className ?? "text-xs text-muted-foreground"}>Admin account: usage is logged, never charged.</p>;
  const what = noun ?? (action === "report" ? "This report" : action === "quick_view" ? "A quick view" : action === "narrate" ? "The AI narration" : "The voice summary");
  const upTo = est.maxFacePence > est.typicalFacePence * 1.15 ? ` (up to ${formatGbp(est.maxFacePence)})` : "";
  let text: React.ReactNode;
  if (est.paidFrom === "topup") {
    text = (
      <>
        {what} will use about {formatGbp(est.typicalFacePence)} of top-up credit{upTo}. Top-up credit is spent at {est.rates.topup}× the plan rate — <Link href="/upgrade" className="underline">upgrade</Link> to pay {formatGbp(est.planCreditPence)}.
      </>
    );
  } else if (est.paidFrom === "mixed") {
    text = (
      <>
        {what} will use about {formatGbp(est.typicalFacePence)} of credit{upTo}: part from your plan credit, the rest from top-up credit at {est.rates.topup}× — {formatGbp(est.planCreditPence)} on a plan.
      </>
    );
  } else if (est.paidFrom === "none") {
    text = (
      <>
        {what} needs about {formatGbp(est.planCreditPence)} of credit{upTo} and you have {formatGbp(est.availablePence)}. <Link href="/upgrade" className="underline">Upgrade</Link> or <Link href="/account/billing#topup" className="underline">top up</Link> first.
      </>
    );
  } else {
    text = (
      <>
        {what} will use about {formatGbp(est.typicalFacePence)} of your {est.paidFrom === "welcome" ? "welcome" : "plan"} credit{upTo}. You have {formatGbp(est.availablePence)}.
      </>
    );
  }
  return <p className={className ?? "text-xs text-muted-foreground"}>{text}</p>;
}
