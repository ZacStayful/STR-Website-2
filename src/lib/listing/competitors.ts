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

export function summariseCompetitors(listings: TrackedListing[], bedrooms?: number): CompetitorSummary {
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
  };
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
