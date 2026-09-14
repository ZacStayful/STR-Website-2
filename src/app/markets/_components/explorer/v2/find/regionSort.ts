import type { SortKey } from "@/lib/market/rank";
import type { RegionCardData } from "../../types";

/** The value a region sorts by for the active key (higher first); keys without a region figure fall back to reports. */
function regionSortValue(r: RegionCardData, key: SortKey): number | null {
  switch (key) {
    case "revenue": return r.headline.grossRevenue;
    case "occupancy": return r.headline.occupancy;
    case "adr": return r.headline.adr;
    case "yield": return r.yieldOnCost?.grossYieldPct ?? null;
    case "competition": return r.competition ? 100 - r.competition.intensity : null;
    case "seasonality": return r.seasonality?.score ?? null;
    case "directBooking": return r.directBooking?.score ?? null;
    default: return r.headline.totalSamples;
  }
}

export function sortRegions(regions: RegionCardData[], key: SortKey): RegionCardData[] {
  return [...regions].sort((a, b) => {
    const va = regionSortValue(a, key);
    const vb = regionSortValue(b, key);
    if (va === null && vb === null) return b.headline.totalSamples - a.headline.totalSamples;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || b.headline.totalSamples - a.headline.totalSamples;
  });
}
