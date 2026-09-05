import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { TrendResult } from "@/lib/market/trend";
import type { MonthBucket } from "@/lib/market/types";

const W = 64;
const H = 22;

/** Tiny enquiry-volume polyline + arrow for a list row. Only drawn with real history. */
export function TrendSparkline({ series, trend, minMonths = 3 }: { series: MonthBucket[]; trend: TrendResult; minMonths?: number }) {
  const withData = series.filter((b) => b.reports > 0).length;
  if (trend.direction === "insufficient" || withData < minMonths) {
    return <span className="mx-trend mx-trend--building" title="Not enough months of data to call a trend yet">Building history</span>;
  }
  const values = series.map((b) => b.reports);
  const max = Math.max(1, ...values);
  const points = values
    .map((v, i) => `${((i / Math.max(1, values.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`)
    .join(" ");
  const Icon = trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;
  const pct = trend.deltaPct === null ? "" : `${trend.deltaPct > 0 ? "+" : ""}${Math.round(trend.deltaPct * 100)}%`;
  return (
    <span className={`mx-trend mx-trend--${trend.direction}`} title={`Enquiries ${pct} vs the previous ${trend.priorMonths} months`}>
      <svg className="mx-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <Icon size={13} aria-hidden /> {pct}
    </span>
  );
}
