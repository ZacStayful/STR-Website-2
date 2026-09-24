import 'server-only';

import { createAdminClient, hasServiceRole } from '../../supabase/admin';
import type { TrackedListing } from '../../listing/competitors';
import type { ShortLetComparable } from '../../types';

/**
 * Rung-1 sources: answers we already hold in our own database. Free.
 */


/**
 * A comparable we already stored for this Airbnb listing id in a recent
 * analyser report (comps carry their listing id inside the Airbnb URL).
 */
export async function storedCompForListing(listingId: string, maxAgeDays = 30): Promise<TrackedListing | null> {
  if (!hasServiceRole() || !/^\d+$/.test(listingId)) return null;
  const admin = createAdminClient();
  const since = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000).toISOString();
  // `raw_response` holds the full AnalysisResult; jsonb containment matches a
  // comparable whose url is exactly the canonical Airbnb URL we construct.
  const url = `https://www.airbnb.co.uk/rooms/${listingId}`;
  const { data, error } = await admin
    .from('analyser_reports')
    .select('raw_response, created_at')
    .gte('created_at', since)
    .contains('raw_response', { shortLet: { comparables: [{ url }] } })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const raw = data[0].raw_response as { shortLet?: { comparables?: ShortLetComparable[] } } | null;
  const comp = raw?.shortLet?.comparables?.find((c) => c.url?.endsWith(`/rooms/${listingId}`));
  if (!comp) return null;
  return {
    listingId,
    name: comp.title,
    url: comp.url,
    lat: 0,
    lng: 0,
    bedrooms: comp.bedrooms,
    bathrooms: 0,
    guests: comp.accommodates,
    roomType: '',
    propertyType: '',
    annualRevenue: comp.annualRevenue,
    adr: comp.averageDailyRate,
    occupancy: comp.occupancyRate,
    reviewCount: comp.reviewCount,
    rating: comp.rating,
    activeDays: comp.daysAvailable,
    thumbnailUrl: comp.thumbnailUrl,
    distanceKm: comp.distance,
  };
}

export interface AreaRentFigures {
  /** Mean long-let monthly rent across the matching reports. */
  monthlyRent: number;
  samples: number;
}

/** Key for the rent table: postcode area and bedroom count. */
export function areaRentKey(postcodeArea: string, bedrooms: number): string {
  return `${postcodeArea.trim().toUpperCase()}|${Math.round(bedrooms)}`;
}

/**
 * Mean long-let monthly rent per postcode area and bedroom count, from long-let
 * estimates we have ALREADY paid PropertyData for.
 *
 * Every analyser report fetches a real rent for a real postcode and stores the
 * whole AnalysisResult in `raw_response`, so these rents are already on disk —
 * this reads them back, free, exactly as `storedPostcodeFigures` does for
 * short-let revenue. Coverage grows with every report run.
 *
 * Returned as one table rather than a lookup per property: screening the whole
 * stored listing pool touches a few hundred area/bedroom cohorts, and a query
 * each would be a few hundred round trips for data that fits in one read.
 *
 * Grouped by postcode AREA rather than outcode on purpose: the short-let revenue
 * these rents are compared against is itself an area-and-bedroom average, so a
 * tighter rent would be false precision on one side of the comparison.
 */
export async function storedAreaRentTable(maxAgeDays = 365): Promise<Map<string, AreaRentFigures>> {
  const out = new Map<string, AreaRentFigures>();
  if (!hasServiceRole()) return out;
  const admin = createAdminClient();
  const since = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000).toISOString();
  const PAGE = 1000;
  const totals = new Map<string, { sum: number; n: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('analyser_reports')
      .select('postcode_area, bedrooms, rent:raw_response->longLet->>monthlyRent')
      .not('postcode_area', 'is', null)
      .not('bedrooms', 'is', null)
      .gte('created_at', since)
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn('[internal] stored rent read failed:', error.message);
      break;
    }
    const rows = (data ?? []) as { postcode_area: string; bedrooms: number; rent: unknown }[];
    for (const r of rows) {
      const rent = Number(r.rent);
      if (!Number.isFinite(rent) || rent <= 0) continue;
      const key = areaRentKey(r.postcode_area, r.bedrooms);
      const acc = totals.get(key) ?? { sum: 0, n: 0 };
      acc.sum += rent;
      acc.n += 1;
      totals.set(key, acc);
    }
    if (rows.length < PAGE) break;
  }
  for (const [key, { sum, n }] of totals) out.set(key, { monthlyRent: Math.round(sum / n), samples: n });
  return out;
}

export interface PostcodeFigures {
  samples: number;
  grossRevenue: number | null;
  adr: number | null;
  occupancy: number | null; // 0–100
  latestAt: string | null;
}

/** Average of recent analyser reports for the same postcode + bedrooms. */
export async function storedPostcodeFigures(postcode: string, bedrooms: number, maxAgeDays = 90): Promise<PostcodeFigures | null> {
  if (!hasServiceRole()) return null;
  const admin = createAdminClient();
  const since = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000).toISOString();
  const pc = postcode.replace(/\s+/g, '').toUpperCase();
  const { data, error } = await admin
    .from('analyser_reports')
    .select('gross_revenue, adr, occupancy, created_at, postcode')
    .eq('bedrooms', bedrooms)
    .gte('created_at', since)
    .or(`postcode.eq.${pc},postcode.eq.${pc.slice(0, -3)} ${pc.slice(-3)}`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data || data.length === 0) return null;
  const nums = (k: 'gross_revenue' | 'adr' | 'occupancy') => data.map((r) => Number(r[k])).filter((v) => Number.isFinite(v) && v > 0);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const occ = nums('occupancy').map((v) => (v <= 1 ? v * 100 : v));
  return { samples: data.length, grossRevenue: avg(nums('gross_revenue')), adr: avg(nums('adr')), occupancy: avg(occ), latestAt: data[0].created_at as string };
}
