"use client";

import { bandPositions, estimatePosition, type AnnualEarningsRange } from "@/lib/comps/earnings";
import { trendDetail, trendSentence, type LocalTrend } from "@/lib/comps/local-trend";

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/**
 * What similar listings earn, under the hero: the comparables' middle half
 * as a band, ticks at the median and top 10%, and a marker where our
 * estimate sits. Sits on the hero's dark panel, so it uses its colours.
 * Uses every comparable (not the user's exclusions), like the headline.
 */
export function EarningsRangeStrip({
  annual,
  estimate,
  revenues,
  trend,
}: {
  annual: AnnualEarningsRange | null;
  estimate: number;
  revenues: number[];
  trend: LocalTrend | null;
}) {
  if (!annual && !trend) return null;
  const pos = annual ? bandPositions(annual, estimate) : null;
  const where = annual ? estimatePosition(revenues, estimate) : null;
  const detail = trend ? trendDetail(trend) : null;
  const pctLeft = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="mt-6 border-t border-primary-foreground/15 pt-6">
      {annual && pos && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-primary-foreground/70 uppercase tracking-wider">What similar listings earn</p>
            <p className="text-[11px] text-primary-foreground/60">
              {annual.n} comparables · gross a year
            </p>
          </div>

          <div className="relative mt-7 h-3" role="img" aria-label={`Similar listings earn between ${gbp(annual.p25)} and ${gbp(annual.p75)} a year in the middle half; our estimate is ${gbp(estimate)}`}>
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary-foreground/25" />
            <div
              className="absolute top-0 h-3 rounded-sm bg-primary-foreground/35"
              style={{ left: pctLeft(pos.p25), width: pctLeft(Math.max(0.005, pos.p75 - pos.p25)) }}
            />
            <div className="absolute -top-1 h-5 w-0.5 bg-primary-foreground" style={{ left: pctLeft(pos.p50) }} />
            {pos.p90 !== null && <div className="absolute -top-0.5 h-4 w-px bg-primary-foreground/60" style={{ left: pctLeft(pos.p90) }} />}
            <div className="absolute -top-6 flex -translate-x-1/2 flex-col items-center" style={{ left: pctLeft(pos.estimate) }}>
              <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">Our estimate</span>
              <span className="text-[10px] leading-none text-primary-foreground">▼</span>
            </div>
          </div>

          <p className="mt-3 text-xs text-primary-foreground/85">
            Bottom quarter {gbp(annual.p25)} · Middle {gbp(annual.p50)} · Top quarter {gbp(annual.p75)}
            {annual.p90 !== null && <> · Top 10% {gbp(annual.p90)}</>}
          </p>
          {where && (
            <p className="mt-1 text-[11px] text-primary-foreground/70">
              Our estimate of {gbp(estimate)} sits {where.phrase.startsWith("about") ? `at ${where.phrase} of these listings` : where.phrase}.
            </p>
          )}
        </>
      )}
      {trend && (
        <p className={`${annual ? "mt-3" : ""} text-[11px] leading-relaxed text-primary-foreground/80`}>
          {trendSentence(trend)}
          {detail && <> {detail}</>}
        </p>
      )}
    </div>
  );
}
