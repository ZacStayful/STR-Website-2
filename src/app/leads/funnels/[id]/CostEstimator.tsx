"use client";

import Link from "next/link";
import { useState } from "react";
import { recommendTopup, type FunnelCost } from "@/lib/funnels/cost";

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

export function CostEstimator({
  perLead,
  reportDepth,
  presets,
}: {
  perLead: DepthCosts;
  reportDepth: "standard" | "enhanced";
  presets: number[];
}) {
  const [leads, setLeads] = useState(50);
  const [depth, setDepth] = useState<"standard" | "enhanced">(reportDepth);

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
