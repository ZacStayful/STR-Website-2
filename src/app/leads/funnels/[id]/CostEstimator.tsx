"use client";

import Link from "next/link";
import { useState } from "react";
import { funnelTierCost, recommendTopup, type FunnelCost } from "@/lib/funnels/cost";
import { usageLine, type FunnelTier } from "@/lib/funnels/tiers";

/**
 * What this funnel will cost, before it goes live.
 *
 * Every figure comes from the server, computed with the same
 * `estimateAction` the analyse route prices a real lead with — the numbers
 * are not recalculated in the browser, they are looked up. A quote that
 * disagreed with the charge would be worse than no quote.
 *
 * Both depths are shown side by side rather than only the one currently
 * chosen: "what would enhanced cost me?" is exactly the question a customer
 * is asking at this point, and making them save a setting to find out is a
 * poor way to answer it.
 */

export interface DepthCosts {
  standard: FunnelCost;
  enhanced: FunnelCost;
}

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const gbpRound = (pence: number) => `£${Math.round(pence / 100).toLocaleString("en-GB")}`;

/** Batch 22f: an owner on volume tiers (src/lib/funnels/tiers.ts). */
export interface TierPricing {
  tiers: FunnelTier[];
  enhancedExtraPence: number;
  topupRate: number;
  /** Leads charged so far this UK month. */
  monthCount: number;
}

export function CostEstimator({
  perLead,
  reportDepth,
  presets,
  tierPricing,
}: {
  perLead: DepthCosts;
  reportDepth: "standard" | "enhanced";
  presets: number[];
  tierPricing?: TierPricing | null;
}) {
  const [leads, setLeads] = useState(50);
  const [depth, setDepth] = useState<"standard" | "enhanced">(reportDepth);
  if (tierPricing) return <TierEstimator pricing={tierPricing} reportDepth={reportDepth} presets={presets} />;

  // Only the lead count changes here, so the per-lead price is reused rather
  // than re-derived — the arithmetic below is multiplication, not pricing.
  const base = perLead[depth];
  const monthly = base.perLeadPence * Math.max(0, Math.floor(leads));
  // The tested helper, not a copy of it: two implementations of "which
  // top-up covers this" would disagree the first time the presets change.
  const recommended = recommendTopup(monthly, presets);

  return (
    <section className="mt-6 rounded-xl border border-border p-5">
      <h2 className="text-base font-semibold text-foreground">What will this cost?</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        You pay per lead, from your credit balance — there is no subscription for this. Nothing is charged until
        someone actually completes your form.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-xs font-medium text-foreground">Leads a month</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={leads}
            onChange={(e) => setLeads(Number(e.target.value))}
            className="mt-1 w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>

        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
          {(["standard", "enhanced"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize ${
                depth === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}
              {d === reportDepth ? " (yours)" : ""}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure label="Per lead" value={gbp(base.perLeadPence)} note={`up to ${gbp(base.perLeadWorstCasePence)} reserved`} />
        <Figure label="A month" value={gbpRound(monthly)} note={`${Math.max(0, Math.floor(leads))} leads`} />
        <Figure
          label="Suggested top-up"
          value={gbpRound(recommended)}
          note={base.perLeadPence > 0 ? `about ${Math.floor(recommended / base.perLeadPence)} leads` : ""}
        />
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        The higher figure is what we hold while a report runs, in case every lookup takes its slowest path; the
        difference is released the moment it finishes.{" "}
        {depth === "enhanced"
          ? "Enhanced adds a second, independent revenue estimate to every report."
          : "Standard is the full report without the second revenue estimate."}
      </p>

      <p className="mt-3 text-xs text-muted-foreground">
        Set an automatic top-up so a busy week cannot pause your funnel — we will email you before anything is
        charged. <Link href="/account/billing#topup" className="underline underline-offset-2">Billing</Link>
      </p>
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-foreground">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * Batch 22f: the estimator on volume tiers. Every figure is the tested
 * pricing (funnelTierCost) over the tier rows the server read, shown at both
 * rates: the base price, and what top-up credit pays.
 */
function TierEstimator({ pricing, reportDepth, presets }: { pricing: TierPricing; reportDepth: "standard" | "enhanced"; presets: number[] }) {
  const [leads, setLeads] = useState(50);
  const [depth, setDepth] = useState<"standard" | "enhanced">(reportDepth);
  const settings = { tiers: pricing.tiers, enhancedExtraPence: pricing.enhancedExtraPence };
  const c = funnelTierCost({ leadsPerMonth: leads, enhanced: depth === "enhanced", settings, topupRate: pricing.topupRate, topupPresetsPence: presets });
  const extra = depth === "enhanced" ? pricing.enhancedExtraPence : 0;
  return (
    <section className="mt-6 rounded-xl border border-border p-5">
      <h2 className="text-base font-semibold text-foreground">What will this cost?</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        You pay per lead, from your credit, and each lead is priced by its number in the calendar month. Nothing is charged
        until a report has run; a repeat enquiry or a report that fails is never charged.
      </p>
      <p className="mt-2 text-sm font-medium text-foreground">{usageLine(pricing.monthCount, reportDepth === "enhanced", settings)}</p>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">Leads each month</th>
            <th className="py-1 font-medium">A lead</th>
            <th className="py-1 font-medium">From top-up credit</th>
          </tr>
        </thead>
        <tbody>
          {pricing.tiers.map((t, i) => {
            const next = pricing.tiers[i + 1]?.from ?? null;
            const p = t.pence + extra;
            return (
              <tr key={t.from} className="border-t border-border">
                <td className="py-1.5">{next ? `${t.from}–${next - 1}` : `${t.from} and on`}</td>
                <td className="py-1.5 font-semibold">{gbp(p)}</td>
                <td className="py-1.5">{gbp(Math.round(p * pricing.topupRate))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-xs font-medium text-foreground">Leads a month</span>
          <input type="number" min={0} max={10000} value={leads} onChange={(e) => setLeads(Number(e.target.value))} className="mt-1 w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
          {(["standard", "enhanced"] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDepth(d)} className={`rounded-md px-3 py-1.5 font-medium capitalize ${depth === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {d}
              {d === reportDepth ? " (yours)" : ""}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure label="A month" value={gbpRound(c.monthlyPence)} note={`${gbpRound(c.monthlyTopupPence)} from top-up credit`} />
        <Figure label="Average a lead" value={gbp(c.averagePence)} note={`${Math.max(0, Math.floor(leads))} leads`} />
        <Figure label="Suggested top-up" value={gbpRound(c.recommendedTopupPence)} note={c.leadsPerTopup > 0 ? `about ${c.leadsPerTopup} leads` : ""} />
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        Plan and starter-pack credit pay the price shown; top-up credit is spent at {pricing.topupRate}×.{" "}
        {depth === "enhanced" ? "Enhanced adds a second, independent revenue estimate to every report." : "Standard is the full report without the second revenue estimate."}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Set an automatic top-up so a busy week cannot pause your form. <Link href="/account/billing#topup" className="underline underline-offset-2">Billing</Link>
      </p>
    </section>
  );
}
