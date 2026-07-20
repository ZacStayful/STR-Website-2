import Link from "next/link";
import type { AreaCardData } from "@/lib/market/explorer";
import { gbpCompact, pct } from "@/lib/market/format";
import { areaConfidence } from "@/lib/market/confidence";
import { LicensingBadge } from "./LicensingBadge";
import { VerdictLabel } from "./VerdictLabel";
import { ScoreBadge } from "./ScoreBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";

/**
 * Fully-open area card. Shows revenue, ADR, occupancy, yield-on-cost, licensing,
 * short-vs-long verdict and the transparent score.
 *
 * When `bedroom` is set, the headline figures (revenue/ADR/occupancy/yield/
 * samples/confidence) reflect THAT bedroom count for the area instead of the
 * area-blended average — so the bedroom filter returns bedroom-specific data.
 * Score & verdict stay area-level (they're holistic).
 */
export function AreaCard({ card, bedroom }: { card: AreaCardData; bedroom?: number | null }) {
  const h = card.headline;
  const bed = bedroom != null ? card.byBedrooms.find((b) => b.bedrooms === bedroom) ?? null : null;

  const revenue = bed ? bed.grossRevenue : h.grossRevenue;
  const adr = bed ? bed.adr : h.adr;
  const occupancy = bed ? bed.occupancy : h.occupancy;
  const yieldPct = bed ? bed.grossYieldPct : card.yieldOnCost?.grossYieldPct ?? null;
  const samples = bed ? bed.samples : h.totalSamples;
  const confidence = bed ? areaConfidence(bed.samples) : card.confidence;

  return (
    <Link href={`/markets/${card.slug}`} className="mx-card" prefetch={false}>
      <div className="mx-card-thumb">
        <span className="mx-card-code" aria-hidden>{card.code}</span>
        <h3>{card.name}</h3>
        {card.score && (
          <div className="mx-card-score">
            <ScoreBadge score={card.score} />
          </div>
        )}
      </div>
      <div className="mx-card-body">
        <div className="mx-card-badges">
          <ConfidenceBadge confidence={confidence} samples={samples} />
          <LicensingBadge status={card.licensing.status} label={card.licensing.headline} />
          {bed && <span className="mx-bed-tag">{bed.bedrooms}-bed</span>}
        </div>

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(revenue)}</div>
            <div className="mx-stat-lbl">Avg revenue</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(adr)}</div>
            <div className="mx-stat-lbl">ADR</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{pct(occupancy, 0)}</div>
            <div className="mx-stat-lbl">Occupancy</div>
          </div>
        </div>

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val mx-yield-val">
              {yieldPct !== null ? pct(yieldPct, 1) : "—"}
            </div>
            <div className="mx-stat-lbl">Gross yield-on-cost</div>
          </div>
          <div className="mx-stat" style={{ gridColumn: "span 2" }}>
            <div className="mx-stat-val" style={{ fontSize: "0.9rem" }}>
              <VerdictLabel verdict={card.verdict} compact />
            </div>
            <div className="mx-stat-lbl">{samples} samples{bed ? ` · ${bed.bedrooms}-bed` : ""}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
