import type { AreaCardData, LevelFigures } from "@/lib/market/explorer";
import type { AreaTrend } from "@/lib/market/trend";
import { trendLabel } from "@/lib/market/trend";
import { gbp, gbpCompact, pct } from "@/lib/market/format";

/** The five "Stayful signals" under the KPIs. */
export function SignalsStrip({ area, scope, trend, targetYieldPct }: { area: AreaCardData; scope: LevelFigures; trend: AreaTrend | null; targetYieldPct: number | null }) {
  const lic = area.licensing;
  const v = area.verdict;
  const y = scope.yieldOnCost;
  const dir = trend?.enquiries.direction;
  const signals: { label: string; value: string; sub: string; tone?: "works" | "amber" }[] = [
    { label: "Licensing", value: lic.headline, sub: lic.regionLabel + (lic.changeIncoming ? " · change incoming" : ""), tone: lic.status === "confirmed-unrestricted" ? "works" : lic.status === "confirmed-licensed" ? "amber" : undefined },
    v
      ? { label: "Long-let vs short-let", value: v.winner === "short-let" ? "Short-let ahead" : v.winner === "long-let" ? "Long-let ahead" : "Close call", sub: `${gbp(v.financials.shortLetNetAnnual)} vs ${gbp(v.financials.longLetNetAnnual)} net / yr`, tone: v.winner === "short-let" ? "works" : undefined }
      : { label: "Long-let vs short-let", value: "No comparator yet", sub: "needs an area long-let rent" },
    y
      ? { label: "Yield-on-cost", value: pct(y.grossYieldPct, 1), sub: `on a ${gbpCompact(y.propertyValueMid)} average price`, tone: y.grossYieldPct >= (targetYieldPct ?? 7) ? "works" : undefined }
      : { label: "Yield-on-cost", value: "—", sub: "no property-value data" },
    { label: "Data confidence", value: scope.confidence.label, sub: `${scope.headline.totalSamples} analyser reports` },
    dir && dir !== "insufficient"
      ? { label: "Enquiry trend", value: trendLabel(dir) ?? "—", sub: "last 3 full months vs the 3 before", tone: dir === "up" ? "works" : undefined }
      : { label: "Enquiry trend", value: "Building history", sub: "needs 3+ reports a month on both sides" },
  ];
  return (
    <div className="mx2-signals">
      {signals.map((s) => (
        <div key={s.label} className="mx2-signal">
          <h6 className="mx2-eyebrow">{s.label}</h6>
          <div className={"mx2-signal-value" + (s.tone ? ` is-${s.tone}` : "")}>{s.value}</div>
          <div className="mx2-signal-sub">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
