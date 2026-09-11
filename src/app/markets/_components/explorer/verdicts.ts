import { areaVerdict, dealVerdict, type AreaVerdict, type Verdict } from "@/lib/listing/verdict";
import type { CheckedListingRow } from "@/lib/listing/pipeline";
import type { ExplorerRow, MarketGoals } from "./types";

/** The verdict for a checked listing, from the figures stored with it. */
export function listingVerdict(l: CheckedListingRow): Verdict {
  return dealVerdict({ kind: l.kind, price: l.price, bedrooms: l.bedrooms, deal: l.deal, quick: l.quick });
}

/** The verdict for an area row, for the bedroom count in play and the member's goals. */
export function areaVerdictFor(row: ExplorerRow, bedroom: number | null, goals: MarketGoals | null): AreaVerdict {
  const c = row.card;
  const bed = bedroom != null ? c.byBedrooms.find((b) => b.bedrooms === bedroom) ?? null : null;
  const p = row.personal;
  return areaVerdict({
    name: c.name,
    code: c.code,
    bedroom: bed ? bed.bedrooms : null,
    grossRevenue: bed ? bed.grossRevenue : c.headline.grossRevenue,
    occupancy: bed ? bed.occupancy : c.headline.occupancy,
    yieldPct: bed ? bed.grossYieldPct : c.yieldOnCost?.grossYieldPct ?? null,
    samples: bed ? bed.samples : c.headline.totalSamples,
    grade: c.score?.grade ?? null,
    gradeLabel: c.score?.gradeLabel ?? null,
    competition: c.competition?.label ?? null,
    directBooking: c.directBooking?.label ?? null,
    licensing: { status: c.licensing.status, headline: c.licensing.headline, regionLabel: c.licensing.regionLabel },
    trend: row.trend?.enquiries.direction ?? null,
    fit: p ? { score: p.score, inBudget: p.fit.inBudget, hasBedrooms: p.fit.hasBedrooms, inRange: p.fit.inRange, distanceMiles: p.fit.distanceMiles } : null,
    targetYieldPct: goals?.finance.targetYieldPct ?? null,
  });
}
