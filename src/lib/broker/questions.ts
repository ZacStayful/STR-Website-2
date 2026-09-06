import 'server-only';

import type { Question } from './types';
import { COST_PENCE, TTL } from './config';
import { findNearbyListings } from '../apis/airbtics';
import { gridCell, matchTracked, type TrackedListing } from '../listing/competitors';
import { storedCompForListing, storedPostcodeFigures, type PostcodeFigures } from './providers/internal';
import { pmiStrEstimate, pmiStrMarket, num, type PmiStrEstimate, type PmiStrMarket } from './providers/pmi';

/**
 * The questions the product asks, each with its ladder. Levels: 1 our data,
 * 2 free reads, 3 pennies, 4 expensive (full report only).
 */

// ── Tracked listings around a point (one Airbtics bounds call per 500 m cell) ──
export interface NearbyParams {
  lat: number;
  lng: number;
}
export const nearbyListings: Question<NearbyParams, TrackedListing[]> = {
  name: 'nearbyListings',
  key: (p) => gridCell(p.lat, p.lng),
  rungs: [
    {
      provider: 'airbtics',
      level: 3,
      costPence: COST_PENCE.airbticsBounds,
      ttlMs: TTL.airbticsBounds,
      run: (p) => findNearbyListings(p.lat, p.lng, 1),
    },
  ],
};

// ── One Airbnb listing's own performance ──
export interface ListingPerfParams {
  listingId: string;
  lat?: number;
  lng?: number;
}
export const listingPerformance: Question<ListingPerfParams, TrackedListing> = {
  name: 'listingPerformance',
  key: (p) => p.listingId,
  rungs: [
    { provider: 'internal', level: 1, costPence: 0, ttlMs: TTL.ourData, run: (p) => storedCompForListing(p.listingId) },
    {
      provider: 'airbtics',
      level: 3,
      costPence: COST_PENCE.airbticsBounds,
      ttlMs: TTL.airbticsBounds,
      run: async (p) => {
        if (p.lat === undefined || p.lng === undefined) return null;
        const list = await findNearbyListings(p.lat, p.lng, 0.6);
        return list ? matchTracked(list, p.listingId) : null;
      },
    },
    // Reserved: AirROI `GET /listings?listing_id=` slots in here if the spike shows a gap.
  ],
};

// ── Revenue for a postcode + bedroom count ──
export interface PostcodeRevenueParams {
  postcode: string;
  bedrooms: number;
}
export const postcodeRevenue: Question<PostcodeRevenueParams, PostcodeFigures> = {
  name: 'postcodeRevenue',
  key: (p) => `${p.postcode.replace(/\s+/g, '').toUpperCase()}|${p.bedrooms}`,
  rungs: [{ provider: 'internal', level: 1, costPence: 0, ttlMs: TTL.ourData, run: (p) => storedPostcodeFigures(p.postcode, p.bedrooms) }],
};

// ── PMI second opinion for a specific property (50 credits: full report only) ──
export interface SecondOpinionParams {
  postcode: string;
  bedrooms: number;
  bathrooms?: number;
  propertyType?: 'house' | 'apartment';
}
export interface SecondOpinion {
  annualRevenue: number;
  adr: number | null;
  occupancy: number | null; // 0–100
  confidence: 'high' | 'medium' | 'low';
  rangeLow: number | null;
  rangeHigh: number | null;
  monthly: { month: string; revenue: number }[];
  comparables: { listingId: string | null; title: string; revenue: number | null; adr: number | null; occupancy: number | null; rating: number | null; url: string | null; distanceM: number | null }[];
}
function fromPmiEstimate(e: PmiStrEstimate): SecondOpinion | null {
  const annual = num(e.annual_revenue);
  if (annual === null || annual <= 0) return null;
  const occ = num(e.occupancy_rate);
  return {
    annualRevenue: Math.round(annual),
    adr: num(e.average_daily_rate) === null ? null : Math.round(num(e.average_daily_rate)!),
    occupancy: occ === null ? null : Math.round((occ <= 1 ? occ * 100 : occ) * 10) / 10,
    confidence: e.confidence ?? 'low',
    rangeLow: num(e.revenue_range?.lower),
    rangeHigh: num(e.revenue_range?.upper),
    monthly: (e.monthly_breakdown ?? []).map((m) => ({ month: m.month, revenue: Math.round(num(m.revenue) ?? 0) })),
    comparables: (e.comparables ?? []).map((c) => ({
      listingId: c.listing_url?.match(/\/rooms\/(\d+)/)?.[1] ?? null,
      title: c.title ?? 'Listing',
      revenue: num(c.revenue),
      adr: num(c.adr),
      occupancy: num(c.occupancy),
      rating: num(c.rating),
      url: c.listing_url ?? null,
      distanceM: num(c.distance_m),
    })),
  };
}
export const strSecondOpinion: Question<SecondOpinionParams, SecondOpinion> = {
  name: 'strSecondOpinion',
  key: (p) => `${p.postcode.replace(/\s+/g, '').toUpperCase()}|${p.bedrooms}|${p.bathrooms ?? ''}|${p.propertyType ?? ''}`,
  rungs: [
    {
      provider: 'pmi',
      level: 4,
      costPence: COST_PENCE.pmiEstimate,
      ttlMs: TTL.pmiEstimate,
      run: async (p) => {
        const e = await pmiStrEstimate({ postcode: p.postcode, bedrooms: p.bedrooms, bathrooms: p.bathrooms, propertyType: p.propertyType, includeComparables: true });
        return e ? fromPmiEstimate(e) : null;
      },
    },
  ],
};

// ── PMI area STR snapshot for an outcode (3 credits) ──
export interface StrMarketParams {
  outcode: string;
  bedrooms?: number;
}
export interface StrMarketSnapshot {
  location: string | null;
  adr: number | null;
  occupancy: number | null; // 0–100
  revenueAnnual: number | null;
  activeListings: number | null;
  supplyGrowthPct: number | null;
  newListings30d: number | null;
  grade: string | null;
  score: number | null;
  byBedrooms: { bedrooms: number; listings: number | null; adr: number | null; occupancy: number | null; revenueAnnual: number | null }[];
  history: { month: string; revenuePcm: number | null; occupancy: number | null; adr: number | null }[];
  asOf: string | null;
}
function fromPmiMarket(m: PmiStrMarket): StrMarketSnapshot | null {
  const s = m.summary;
  if (!s && !m.by_bedrooms) return null;
  return {
    location: m.location ?? null,
    adr: num(s?.adr),
    occupancy: num(s?.occupancy_pct),
    revenueAnnual: num(s?.revenue_annual) ?? (num(s?.revenue_pcm) === null ? null : Math.round(num(s?.revenue_pcm)! * 12)),
    activeListings: num(s?.active_listings) ?? num(m.supply?.active_listings),
    supplyGrowthPct: num(m.supply?.yoy_growth_pct),
    newListings30d: num(m.supply?.new_listings_30d),
    grade: m.grade?.letter ?? null,
    score: num(m.grade?.score_0_100),
    byBedrooms: (m.by_bedrooms ?? []).map((b) => ({ bedrooms: b.bedrooms, listings: num(b.listings), adr: num(b.adr), occupancy: num(b.occupancy_pct), revenueAnnual: num(b.revenue_pcm) === null ? null : Math.round(num(b.revenue_pcm)! * 12) })),
    history: (m.historical ?? []).slice(-12).map((h) => ({ month: h.month, revenuePcm: num(h.revenue_pcm), occupancy: num(h.occupancy_pct), adr: num(h.adr) })),
    asOf: m.as_of ?? null,
  };
}
export const strMarket: Question<StrMarketParams, StrMarketSnapshot> = {
  name: 'strMarket',
  key: (p) => `${p.outcode.toUpperCase()}|${p.bedrooms ?? ''}`,
  rungs: [
    {
      provider: 'pmi',
      level: 3,
      costPence: COST_PENCE.pmiMarket,
      ttlMs: TTL.pmiMarket,
      run: async (p) => {
        const m = await pmiStrMarket({ outcode: p.outcode }, { bedrooms: p.bedrooms, include: ['summary', 'supply', 'by_bedrooms', 'grade', 'historical'] });
        return m ? fromPmiMarket(m) : null;
      },
    },
  ],
};
