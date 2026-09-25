/**
 * The real number of Airbnb listings around a property, from the bounds
 * search's `total_count` (the search itself returns only the first 50).
 * Display only: risk scores and `activeListings` do not use it.
 *
 * The bounds box is a square ±r either side, so wording says "about".
 * Pure: loadable by `node --test`.
 */

export interface ListingsNearby {
  count: number;
  radiusKm: number;
  area: 'box';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function listingsNearbyFrom(totalCount: unknown, radiusKm: number, comparables: number): ListingsNearby | null {
  if (!finite(totalCount) || !Number.isInteger(totalCount) || totalCount <= 0) return null;
  if (!finite(radiusKm) || radiusKm <= 0) return null;
  if (totalCount < comparables) return null;
  return { count: totalCount, radiusKm: Math.round(radiusKm * 1000) / 1000, area: 'box' };
}

export function readListingsNearby(v: unknown): ListingsNearby | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!finite(r.count) || r.count <= 0 || !finite(r.radiusKm) || r.radiusKm <= 0) return null;
  return { count: r.count, radiusKm: r.radiusKm, area: 'box' };
}

/**
 * The radius for the report's bounds call. Airbtics' report radius when it
 * has one; otherwise the furthest comparable, clamped to 0.2–8 km; 0 means
 * there is nothing to size the box by, so skip the (paid) call.
 */
export function boundsRadiusKm(reportRadiusKm: number, compDistancesKm: ReadonlyArray<number | undefined>): number {
  if (finite(reportRadiusKm) && reportRadiusKm > 0) return reportRadiusKm;
  const d = compDistancesKm.filter((v): v is number => finite(v) && v > 0);
  if (d.length === 0) return 0;
  return Math.min(8, Math.max(0.2, Math.max(...d)));
}

/** 0.197 → "about 200 m"; 1 → "about 1 km"; 1.6 → "about 1.6 km". */
export function approxDistance(km: number): string {
  if (!finite(km) || km <= 0) return 'nearby';
  if (km < 0.95) return `about ${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  const r = Math.round(km * 10) / 10;
  return `about ${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)} km`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

/** "50 of about 1,050" when the total is known and larger, else "50". */
export function nearbyCountLabel(shown: number, total: number | null | undefined): string {
  if (finite(total) && total > shown) return `${formatCount(shown)} of about ${formatCount(total)}`;
  return formatCount(shown);
}

/** "12 comparables from about 115 Airbnb listings within about 200 m" (or the plain form without a count). */
export function comparablesSourceLine(i: { comparables: number; radiusKm: number; nearby: ListingsNearby | null }): string {
  const comps = `${i.comparables} comparable${i.comparables === 1 ? '' : 's'}`;
  if (i.nearby && i.nearby.count > i.comparables) {
    return `${comps} from about ${formatCount(i.nearby.count)} Airbnb listings within ${approxDistance(i.nearby.radiusKm)}`;
  }
  return i.radiusKm > 0 ? `${comps} within ${approxDistance(i.radiusKm)}` : comps;
}
