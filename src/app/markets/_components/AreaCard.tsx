import Link from "next/link";
import type { AreaCardData } from "@/lib/market/explorer";
import { gbpCompact, pct } from "@/lib/market/format";
import { LicensingBadge } from "./LicensingBadge";
import { VerdictLabel } from "./VerdictLabel";

/**
 * Fully-open area card (no lock/paywall — per spec). Shows revenue, ADR,
 * occupancy, yield-on-cost, licensing flag and the short-vs-long verdict.
 * The transparent score is intentionally not rendered yet (pending sign-off).
 */
export function AreaCard({ card }: { card: AreaCardData }) {
  const h = card.headline;
  return (
    <Link href={`/markets/${card.slug}`} className="mx-card" prefetch={false}>
      <div className="mx-card-thumb">
        <span className="mx-card-code" aria-hidden>{card.code}</span>
        <h3>{card.name}</h3>
      </div>
      <div className="mx-card-body">
        <LicensingBadge status={card.licensing.status} label={card.licensing.headline} />

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(h.grossRevenue)}</div>
            <div className="mx-stat-lbl">Avg revenue</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{gbpCompact(h.adr)}</div>
            <div className="mx-stat-lbl">ADR</div>
          </div>
          <div className="mx-stat">
            <div className="mx-stat-val">{pct(h.occupancy, 0)}</div>
            <div className="mx-stat-lbl">Occupancy</div>
          </div>
        </div>

        <div className="mx-stats">
          <div className="mx-stat">
            <div className="mx-stat-val mx-yield-val">
              {card.yieldOnCost ? pct(card.yieldOnCost.grossYieldPct, 1) : "—"}
            </div>
            <div className="mx-stat-lbl">Gross yield-on-cost</div>
          </div>
          <div className="mx-stat" style={{ gridColumn: "span 2" }}>
            <div className="mx-stat-val" style={{ fontSize: "0.9rem" }}>
              <VerdictLabel verdict={card.verdict} compact />
            </div>
            <div className="mx-stat-lbl">{h.totalSamples} samples</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
