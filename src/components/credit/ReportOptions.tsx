"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchEstimate, formatGbp, type EstimateResponse } from "@/lib/credit/client";

/**
 * The standard / enhanced choice above the Run button, with live prices:
 * standard = Airbtics + PropertyData; enhanced adds the PMI second opinion.
 * Shows what the chosen report will use and from which credit bucket.
 */
export function ReportOptions({ enhanced, onChange, disabled }: { enhanced: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const [standard, setStandard] = useState<EstimateResponse | null>(null);
  const [plus, setPlus] = useState<EstimateResponse | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchEstimate("report"), fetchEstimate("report_enhanced")]).then(([s, e]) => {
      if (!alive) return;
      setStandard(s);
      setPlus(e);
    });
    return () => {
      alive = false;
    };
  }, []);

  const est = enhanced ? plus : standard;
  const admin = standard?.admin ?? false;
  const fromTopup = est?.paidFrom === "topup";
  const price = (e: EstimateResponse | null) => (e ? formatGbp(fromTopup ? e.topupCreditPence : e.planCreditPence) : null);
  const extra = standard && plus ? (fromTopup ? plus.topupCreditPence - standard.topupCreditPence : plus.planCreditPence - standard.planCreditPence) : null;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={enhanced} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        <span className="text-sm">
          <span className="font-medium text-foreground">Add the PMI second opinion</span>
          {extra !== null && <span className="text-muted-foreground"> · +{formatGbp(extra)}</span>}
          <span className="block text-xs text-muted-foreground">An independent 12-month projection with its own comparables from Property Market Intel, shown alongside the Airbtics figures.</span>
        </span>
      </label>
      {admin ? (
        <p className="text-xs text-muted-foreground">Admin account: usage is logged, never charged.</p>
      ) : est ? (
        <p className="text-xs text-muted-foreground">
          This {enhanced ? "enhanced" : "standard"} report will use about {price(est)} of {fromTopup ? "top-up" : est.paidFrom === "welcome" ? "welcome" : "plan"} credit
          {est.maxBasePence > est.typicalBasePence * 1.15 ? ` (up to ${formatGbp(fromTopup ? est.maxTopupCreditPence : est.maxBasePence)} if extra data lookups are needed)` : ""}. You have {formatGbp(est.availablePence)}.
          {fromTopup && (
            <>
              {" "}
              Top-up credit is spent at {est.rates.topup}× the plan rate — <Link href="/upgrade" className="underline">upgrade</Link> to pay {formatGbp(est.planCreditPence)}.
            </>
          )}
          {est.paidFrom === "none" && (
            <>
              {" "}
              <Link href="/upgrade" className="underline">Upgrade</Link> or <Link href="/account/billing#topup" className="underline">top up</Link> first.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
