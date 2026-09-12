"use client";

import { formatGbp, type EstimateResponse } from "@/lib/credit/client";

/**
 * The one-line nudge every top-up surface shows: what a top-up buys versus a
 * subscription, in reports, using the live report estimate when available.
 */
export function RateComparison({ estimate, presets, className }: { estimate: EstimateResponse | null; presets: number[]; className?: string }) {
  const plan = estimate?.planCreditPence ?? 347;
  const topup = estimate?.topupCreditPence ?? Math.round(plan * 1.5);
  const mid = presets[1] ?? 2500;
  const reports = (pence: number, per: number) => (per > 0 ? (pence / per).toFixed(1).replace(/\.0$/, "") : "—");
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      A standard report costs about {formatGbp(plan)} of plan credit or {formatGbp(topup)} of top-up credit. {formatGbp(mid).replace(".00", "")} top-up ≈ {reports(mid, topup)} reports · Starter £19/month ≈ {reports(1900, plan)} reports · Pro £39.99/month ≈ {reports(5000, plan)} reports.
    </p>
  );
}
