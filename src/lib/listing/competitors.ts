/**
 * Pure helpers over the tracked-listing rows Airbtics returns for a
 * bounding box (see findNearbyListings in src/lib/apis/airbtics.ts).
 */

export interface TrackedListing {
  listingId: string;
  name: string;
  url: string;
  lat: number;
  lng: number;
  bedrooms: number;
  bathrooms: number;
  guests: number;
  roomType: string;
  propertyType: string;
  annualRevenue: number;
  adr: number;
  occupancy: number; // 0–1
  reviewCount: number;
  rating: number; // 0–5
  activeDays: number;
  listedSince?: string;
  thumbnailUrl?: string;
  distanceKm?: number;
}

export interface CompetitorSummary {
  count: number;
  /** Listings with revenue > 0 (used for medians). */
  earning: number;
  medianRevenue: number | null;
  topQuartileRevenue: number | null;
  medianAdr: number | null;
  medianOccupancy: number | null; // 0–1
  medianReviews: number | null;
  /** Listings with the same bedroom count, when known. */
  sameSize: number;
  /**
   * Airbtics' total count for the whole box, of which `count` is the first
   * page. Display only; absent on summaries built before it was kept.
   */
  totalNearby?: number | null;
}

/**
 * The nearby-listings answer: the first page plus the box's total count.
 * The broker cache also still holds the older bare arrays (and serves stale
 * rows indefinitely), so read it through `nearbyPageOf`.
 */
export interface NearbyListingsPage {
  listings: TrackedListing[];
  totalCount: number | null;
  radiusKm?: number;
}
export type NearbyListingsValue = TrackedListing[] | NearbyListingsPage;

export function nearbyPageOf(v: unknown): NearbyListingsPage | null {
  if (Array.isArray(v)) return { listings: v as TrackedListing[], totalCount: null };
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.listings)) return null;
  const total = typeof r.totalCount === 'number' && Number.isFinite(r.totalCount) && r.totalCount > 0 ? r.totalCount : null;
  return {
    listings: r.listings as TrackedListing[],
    totalCount: total,
    ...(typeof r.radiusKm === 'number' ? { radiusKm: r.radiusKm } : {}),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function summariseCompetitors(listings: TrackedListing[], bedrooms?: number, totalNearby?: number | null): CompetitorSummary {
  const earning = listings.filter((l) => l.annualRevenue > 0);
  const rev = earning.map((l) => l.annualRevenue);
  return {
    count: listings.length,
    earning: earning.length,
    medianRevenue: round(median(rev)),
    topQuartileRevenue: round(quantile(rev, 0.75)),
    medianAdr: round(median(earning.map((l) => l.adr).filter((v) => v > 0))),
    medianOccupancy: median(earning.map((l) => l.occupancy).filter((v) => v > 0)),
    medianReviews: round(median(listings.map((l) => l.reviewCount))),
    sameSize: bedrooms === undefined ? 0 : listings.filter((l) => l.bedrooms === bedrooms).length,
    ...(typeof totalNearby === 'number' && totalNearby > listings.length ? { totalNearby } : {}),
  };
}

/**
 * Mean of the positive values only, ignoring zeros. A zero review count
 * means "nobody has reviewed this yet", not "this market averages zero",
 * so counting zeros would drag a market's saturation reading down and make
 * a crowded market look open.
 */
export function meanOfPositive(values: number[]): number | null {
  const kept = values.filter((v) => Number.isFinite(v) && v > 0);
  if (kept.length === 0) return null;
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

/**
 * Average review count across a report's comparables, rounded to a whole
 * number. Shared by the analyser UI and the lead-qualification rules so the
 * figure a customer sets a threshold against is the figure they were shown.
 * Structurally typed: both `TrackedListing` and `ShortLetComparable` fit.
 */
export function averageReviewCount(comps: ReadonlyArray<{ reviewCount: number }>): number | null {
  return round(meanOfPositive(comps.map((c) => c.reviewCount)));
}

/** Average guest rating across a report's comparables, to two decimals. */
export function averageRating(comps: ReadonlyArray<{ rating: number }>): number | null {
  const mean = meanOfPositive(comps.map((c) => c.rating));
  return mean === null ? null : Math.round(mean * 100) / 100;
}

export function matchTracked(listings: TrackedListing[], listingId: string): TrackedListing | null {
  return listings.find((l) => l.listingId === listingId) ?? null;
}

/** Nearest-first, earning listings first, capped. */
export function rankCompetitors(listings: TrackedListing[], limit = 12): TrackedListing[] {
  return [...listings]
    .sort((a, b) => {
      const ea = a.annualRevenue > 0 ? 0 : 1;
      const eb = b.annualRevenue > 0 ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    })
    .slice(0, limit);
}

/** 500 m grid cell key used to cache bounds lookups. */
export function gridCell(lat: number, lng: number, sizeDeg = 0.0045): string {
  const la = Math.floor(lat / sizeDeg) * sizeDeg;
  const ln = Math.floor(lng / (sizeDeg * 1.7)) * (sizeDeg * 1.7);
  return `${la.toFixed(4)},${ln.toFixed(4)}`;
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}
