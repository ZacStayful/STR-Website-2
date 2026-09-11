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
