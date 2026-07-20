import type { AreaCardData } from "@/lib/market/explorer";
import { areaConfidence, type Confidence } from "@/lib/market/confidence";

export interface ActiveStats {
  revenue: number | null;
  adr: number | null;
  occupancy: number | null;
  yieldPct: number | null;
  samples: number;
  confidence: Confidence;
  bedroom: number | null; // the bedroom count these stats are for, or null for area blend
}

/**
 * The stats a card/compare row should display: bedroom-specific when a bedroom
 * is selected (and the area has it), otherwise the area-blended headline.
 * Single source so the card and the comparison table never diverge.
 */
export function activeAreaStats(card: AreaCardData, bedroom?: number | null): ActiveStats {
  const h = card.headline;
  const bed = bedroom != null ? card.byBedrooms.find((b) => b.bedrooms === bedroom) ?? null : null;
  return {
    revenue: bed ? bed.grossRevenue : h.grossRevenue,
    adr: bed ? bed.adr : h.adr,
    occupancy: bed ? bed.occupancy : h.occupancy,
    yieldPct: bed ? bed.grossYieldPct : card.yieldOnCost?.grossYieldPct ?? null,
    samples: bed ? bed.samples : h.totalSamples,
    confidence: bed ? areaConfidence(bed.samples) : card.confidence,
    bedroom: bed ? bed.bedrooms : null,
  };
}
