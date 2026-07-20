import Link from "next/link";
import type { AreaCardData } from "@/lib/market/explorer";
import { gbpCompact, pct } from "@/lib/market/format";
import { activeAreaStats } from "./areaStats";
import { LicensingBadge } from "./LicensingBadge";
import { VerdictLabel } from "./VerdictLabel";
import { ScoreBadge } from "./ScoreBadge";
import { ConfidenceBadge } from "./ConfidenceBadge";

/**
 * Fully-open area card. Shows revenue, ADR, occupancy, yield-on-cost, licensing,
 * short-vs-long verdict and the transparent score. When `bedroom` is set the
 * headline figures reflect that bedroom count. A compare toggle (top-left of the
 * thumb) adds/removes the area from the side-by-side comparison.
 */
export function AreaCard({
  card,
  bedroom,
  comparing,
  onToggleCompare,
  compareDisabled,
}: {
  card: AreaCardData;
  bedroom?: number | null;
  comparing?: boolean;
  onToggleCompare?: () => void;
  compareDisabled?: boolean;
}) {
  const s = activeAreaStats(card, bedroom);

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
        {onToggleCompare && (
          <button
            type="button"
            className="mx-compare-toggle"
            aria-pressed={!!comparing}
            disabled={!comparing && compareDisabled}
            title={comparing ? "Remove from compare" : compareDisabled ? "Compare up to 4 areas" : "Add to compare"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleCompare();
            }}
          >
            {comparing ? "✓ Comparing" : "+ Compare"}
          </button>
        )}
      </div>
      <div className="mx-card-body">
        <div className="mx-card-badges">
          <ConfidenceBadge confidence={s.confidence} samples={s.samples} />
          <LicensingBadge status={card.licensing.status} label={card.licensing.headline} />
          {s.bedroom != null && <span className="mx-bed-tag">{s.bedroom}-bed</span>}
        </div>

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(s.revenue)}</div>
            <div className="mx-stat-lbl">Avg revenue</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(s.adr)}</div>
            <div className="mx-stat-lbl">ADR</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{pct(s.occupancy, 0)}</div>
            <div className="mx-stat-lbl">Occupancy</div>
          </div>
        </div>

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val mx-yield-val">
              {s.yieldPct !== null ? pct(s.yieldPct, 1) : "—"}
            </div>
            <div className="mx-stat-lbl">Gross yield-on-cost</div>
          </div>
          <div className="mx-stat" style={{ gridColumn: "span 2" }}>
            <div className="mx-stat-val" style={{ fontSize: "0.9rem" }}>
              <VerdictLabel verdict={card.verdict} compact />
            </div>
            <div className="mx-stat-lbl">{s.samples} samples{s.bedroom != null ? ` · ${s.bedroom}-bed` : ""}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
