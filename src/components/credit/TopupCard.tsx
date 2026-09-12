"use client";

import { useEffect, useState } from "react";
import { fetchEstimate, type EstimateResponse } from "@/lib/credit/client";
import { TopupButtons } from "./TopupButtons";
import { RateComparison } from "./RateComparison";

/** Top-up presets with the rate nudge, used on /upgrade and /account/billing. */
export function TopupCard({ presets, hasSavedCard, topupRate, heading = "Top up" }: { presets: number[]; hasSavedCard: boolean; topupRate: number; heading?: string }) {
  const [est, setEst] = useState<EstimateResponse | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchEstimate("report").then((e) => {
      if (alive) setEst(e);
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div id="topup" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">One-off credit that never expires, spent at {topupRate}× the subscription rate.</p>
      <div className="mt-4">
        <TopupButtons presets={presets} hasSavedCard={hasSavedCard} />
      </div>
      <RateComparison estimate={est} presets={presets} className="mt-3 text-xs text-muted-foreground" />
    </div>
  );
}
