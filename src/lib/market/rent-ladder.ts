/**
 * National long-let rent by bedroom count, and the arithmetic for moving a rent
 * from one bedroom count to another.
 *
 * Two jobs:
 *
 *   1. A last-resort rent when nothing local is known. Always `low` confidence —
 *      a national median is not an estimate for a specific place.
 *   2. A RATIO for rescaling a local rent. The area-average long-let rent in the
 *      market snapshot is fetched for one bedroom count only (the area's modal
 *      size), so comparing it against a 4-bed listing needs it stepped up. The
 *      ladder's shape carries that step; its absolute level does not matter for
 *      this use, only the ratio between two rungs.
 *
 * The ladder is declared HERE, not in ../apis/propertydata.ts, even though that
 * module used to own it: this file is pure, so a test can load it, whereas
 * propertydata.ts pulls in the credit/meter graph. propertydata.ts now imports
 * these values so there is one ladder rather than two that can drift.
 *
 * Pure: no network, no `server-only`.
 */

/** UK median monthly long-let rent by bedroom count (2024, ONS/Zoopla blend). 0 is a studio. */
export const NATIONAL_MONTHLY_RENT: Record<number, number> = {
  0: 950,
  1: 1_100,
  2: 1_400,
  3: 1_650,
  4: 2_050,
  5: 2_500,
};

const MIN_RUNG = 0;
const MAX_RUNG = 5;

/** Clamps a bedroom count onto the ladder: a studio is 0, anything above 5 is treated as 5. */
export function rungFor(bedrooms: number): number {
  return Math.min(Math.max(Math.round(bedrooms), MIN_RUNG), MAX_RUNG);
}

/** The national monthly rent for a bedroom count. */
export function nationalRentFor(bedrooms: number): number {
  return NATIONAL_MONTHLY_RENT[rungFor(bedrooms)];
}

/**
 * Moves a known monthly rent from one bedroom count to another by the ladder's
 * ratio. Returns the rent unchanged when the two counts land on the same rung,
 * so an exact match is never distorted by rounding.
 */
export function scaleRentToBedrooms(rent: number, fromBedrooms: number, toBedrooms: number): number {
  if (!Number.isFinite(rent) || rent <= 0) return 0;
  const from = rungFor(fromBedrooms);
  const to = rungFor(toBedrooms);
  if (from === to) return Math.round(rent);
  return Math.round(rent * (NATIONAL_MONTHLY_RENT[to] / NATIONAL_MONTHLY_RENT[from]));
}

/**
 * The bedroom count with the most samples, which is the size an area-level
 * figure actually describes. Ties break to the smaller count, matching the
 * ascending sort the aggregator emits.
 */
export function modalBedroomsOf(groups: { bedrooms: number; samples: number }[]): number | null {
  let best: number | null = null;
  let bestSamples = -1;
  for (const g of [...groups].sort((a, b) => a.bedrooms - b.bedrooms)) {
    if (g.samples > bestSamples) {
      bestSamples = g.samples;
      best = g.bedrooms;
    }
  }
  return best;
}
