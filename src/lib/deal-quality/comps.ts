/**
 * The comparables side of a deal check: which nearby Airbnbs count as
 * similar to the listing, how far the search widens, how consistent their
 * revenue is (the confidence), and the shape the analyser's pipeline reads.
 *
 * A deal check asks Airbtics' listings search for entire homes with the
 * listing's bedroom count, nearest first, at the listing's own location
 * (5p a call). Similar means: same bedrooms, entire home, earning, within
 * the search radius, and of the same kind (flat or house) when the portal
 * says which. The search widens through the radius steps until it holds the
 * target count, the last step or the per-check call limit. The comparables
 * then run through the analyser's own pipeline (airbtics.ts
 * buildDataFromReportComps); nothing here averages revenue itself.
 *
 * Pure: no network, no database, no server-only.
 */
import type { Confidence } from '../listing/screen.ts';
import type { DealCompsSettings, DealConfidenceSettings } from './config.ts';

/** One Airbnb listing as Airbtics' listings search returns it: the fields a deal check reads. */
export interface CompListing {
  listingID: string | number;
  name?: string | null;
  latitude: number;
  longitude: number;
  /** A number, a numeric string, or "Studio". */
  bedrooms: number | string | null;
  bathrooms?: number | null;
  accommodates?: number | null;
  room_type?: string | null;
  property_type?: string | null;
  room_and_property_type?: string | null;
  added_on?: string | null;
  visible_review_count?: number | null;
  /** 0–5, or 0–100 on some rows. */
  reveiw_scores_rating?: number | null;
  avg_booked_daily_rate_ltm?: number | null;
  /** 0–100. */
  avg_occupancy_rate_ltm?: number | null;
  annual_revenue_ltm?: number | null;
  active_days_count_ltm?: number | null;
  no_of_bookings_ltm?: number | null;
  minimum_nights?: number | null;
  host_name?: string | null;
  amenities?: Record<string, boolean> | null;
}

export interface SimilarComp extends CompListing {
  distanceKm: number;
}

/** What Airbnb calls the property, reduced to what matters for a comparison. */
export type TypeBucket = 'flat' | 'house' | 'other' | 'unknown';
/** What the portal says the subject is. */
export type SubjectKind = 'flat' | 'house' | 'unknown';

export interface Subject {
  lat: number;
  lng: number;
  bedrooms: number;
  kind: SubjectKind;
}

/** Airbtics' listings search returns at most this many listings a page. */
export const PAGE_SIZE = 50;
/** The pipeline reads at most this many comparables, as many as a full analysis's report returns. */
export const POOL_LIMIT = 40;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "Studio" → 0, "3" → 3, 3 → 3; anything else null. */
export function bedroomsOf(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'studio') return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function isEntireHome(l: Pick<CompListing, 'room_type' | 'room_and_property_type'>): boolean {
  const room = (l.room_type ?? '').toLowerCase();
  if (room) return room === 'entire_home' || room.startsWith('entire');
  return /^entire\b/i.test(l.room_and_property_type ?? '');
}

const OTHER = /cabin|chalet|lodge|hut|boat|camper|\brv\b|tent|yurt|treehouse|tiny|glamping|caravan|shepherd|dome|cave|castle|hotel|hostel|bed_and_breakfast|bed and breakfast|\bb&b\b|farm_stay|farm stay/;
const FLAT = /condo|apartment|rental_unit|rental unit|serviced|loft|aparthotel|\bflat\b|guest_suite|guest suite|studio/;
const HOUSE = /home|house|townhouse|villa|bungalow|cottage|barn|guesthouse|guest house|terrace|semi|detached/;

/** The comparable's kind from Airbnb's property type (falling back to the combined label). */
export function typeBucket(l: Pick<CompListing, 'property_type' | 'room_and_property_type'>): TypeBucket {
  const text = `${l.property_type ?? ''} ${l.room_and_property_type ?? ''}`.toLowerCase().trim();
  if (!text) return 'unknown';
  if (OTHER.test(text)) return 'other';
  if (FLAT.test(text)) return 'flat';
  if (HOUSE.test(text)) return 'house';
  return 'unknown';
}

/** A comparable of unknown kind counts for either; holiday-park kinds only for an unknown subject. */
export function kindMatches(subject: SubjectKind, comp: TypeBucket): boolean {
  if (subject === 'unknown' || comp === 'unknown') return true;
  return subject === comp;
}

export interface Similar {
  /** Same bedrooms, entire home, earning, in radius and of the subject's kind; nearest first. */
  matched: SimilarComp[];
  /** The same without the kind test, for when the kind leaves too few. */
  anyKind: SimilarComp[];
}

/** The similar comparables among everything the searches returned, deduplicated, nearest first. */
export function similarComps(listings: readonly CompListing[], subject: Subject, radiusKm: number): Similar {
  const seen = new Set<string>();
  const anyKind: SimilarComp[] = [];
  for (const l of listings) {
    const id = String(l.listingID);
    if (seen.has(id)) continue;
    if (!Number.isFinite(l.latitude) || !Number.isFinite(l.longitude)) continue;
    if (bedroomsOf(l.bedrooms) !== subject.bedrooms) continue;
    if (!isEntireHome(l)) continue;
    if (!((l.annual_revenue_ltm ?? 0) > 0)) continue;
    const d = distanceKm({ lat: subject.lat, lng: subject.lng }, { lat: l.latitude, lng: l.longitude });
    if (d > radiusKm) continue;
    seen.add(id);
    anyKind.push({ ...l, distanceKm: Math.round(d * 100) / 100 });
  }
  anyKind.sort((a, b) => a.distanceKm - b.distanceKm);
  return { matched: anyKind.filter((c) => kindMatches(subject.kind, typeBucket(c))), anyKind };
}

/** The smallest step at or beyond `km`; the largest step when none is. */
export function stepAtLeast(radii: readonly number[], km: number): number {
  return radii.find((r) => r >= km - 1e-9) ?? radii[radii.length - 1];
}

/**
 * Where the first search starts: the smallest step, wherever the listing
 * is. The analyser's own search does the same (0.4 km first, widening until
 * it holds 12), and Step 0's first run showed why it matters: coastal and
 * rural searches that began at their class's 5 km took the comparables from
 * a circle the stored reports had found theirs within 0.2–1.8 km of, and
 * read 15–18% apart from them; urban searches, which began at 0.8 km, read
 * 7% apart. A sparse area costs a call or two more; a dense one costs the
 * same and reads its own street.
 */
export function startRadiusKm(settings: Pick<DealCompsSettings, 'radiiKm'>): number {
  return settings.radiiKm[0];
}

export interface SearchStep {
  radiusKm: number;
  page: number;
}

export interface StepResult extends SearchStep {
  /** Listings on the page. */
  returned: number;
  /** Airbtics' count of listings in the whole box. */
  totalCount: number;
}

/**
 * The next search, or null to stop. A full page whose box holds more is read
 * on (nearest first, so the next page holds the next nearest); otherwise the
 * search widens to the step whose area should hold the target at the density
 * found so far.
 */
export function nextSearchStep(settings: Pick<DealCompsSettings, 'radiiKm' | 'targetCount' | 'maxRadiusKm'>, done: readonly StepResult[], similarFound: number, callsLeft: number): SearchStep | null {
  if (similarFound >= settings.targetCount || callsLeft <= 0) return null;
  const last = done[done.length - 1];
  if (!last) return null;
  if (last.returned >= PAGE_SIZE && last.totalCount > last.page * PAGE_SIZE) return { radiusKm: last.radiusKm, page: last.page + 1 };
  if (last.radiusKm >= settings.maxRadiusKm) return null;
  const wanted = last.radiusKm * Math.sqrt(settings.targetCount / Math.max(similarFound, 1));
  const radius = stepAtLeast(settings.radiiKm, Math.max(wanted, last.radiusKm + 1e-6));
  return radius > last.radiusKm ? { radiusKm: Math.min(radius, settings.maxRadiusKm), page: 1 } : null;
}

/**
 * The setting check: on a wide search, a comparable sitting among many more
 * similar listings than the subject has around it is in a town the subject
 * is not in. Only when every listing in the box was read (a partial page
 * would undercount the far comparables' neighbours) and only if enough
 * comparables stay.
 */
export function settingFilter(comps: readonly SimilarComp[], subject: Pick<Subject, 'lat' | 'lng'>, radiusKm: number, everyListingRead: boolean, s: DealCompsSettings['setting'], minComps: number): { kept: SimilarComp[]; dropped: number; applied: boolean } {
  const unchanged = { kept: [...comps], dropped: 0, applied: false };
  if (!everyListingRead || radiusKm < s.minRadiusKm || comps.length <= minComps) return unchanged;
  const near = (a: { lat: number; lng: number }) => comps.filter((c) => distanceKm(a, { lat: c.latitude, lng: c.longitude }) <= s.neighbourKm).length;
  const subjectNeighbours = near({ lat: subject.lat, lng: subject.lng });
  const kept = comps.filter((c) => {
    const neighbours = near({ lat: c.latitude, lng: c.longitude }) - 1;
    return !(neighbours >= s.minCluster && neighbours >= s.ratio * (subjectNeighbours + 1));
  });
  if (kept.length < minComps) return unchanged;
  return { kept, dropped: comps.length - kept.length, applied: true };
}

/** Linear-interpolated quantile of sorted values. */
function quantile(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface Spread {
  median: number;
  q1: number;
  q3: number;
  /** How far the middle half reaches from the median, % of the median (the larger side). */
  spreadPct: number;
}

/** The middle half of the comparables' annual revenue against their median; null under two positive values. */
export function revenueSpread(values: readonly number[]): Spread | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const spreadPct = median > 0 ? (Math.max(median - q1, q3 - median) / median) * 100 : Number.POSITIVE_INFINITY;
  return { median, q1, q3, spreadPct: Math.round(spreadPct * 10) / 10 };
}

export type DealConfidence = Confidence | 'insufficient';

/**
 * High when the middle half of the comparables' revenue sits within
 * ±highPct of their median, medium within ±mediumPct, low beyond. Up to
 * mediumMaxComps comparables is at most medium; under minComps there is not
 * enough to go on.
 */
export function confidenceFor(spread: Spread | null, compCount: number, c: DealConfidenceSettings, minComps: number): DealConfidence {
  if (compCount < minComps || spread === null) return 'insufficient';
  if (spread.spreadPct <= c.highPct) return compCount > c.mediumMaxComps ? 'high' : 'medium';
  if (spread.spreadPct <= c.mediumPct) return 'medium';
  return 'low';
}

/**
 * A comparable in the shape the analyser's pipeline reads from a full
 * report (airbtics.ts ReportComp). The listings search carries no monthly
 * history, so those are empty and the pipeline takes its UK seasonal
 * fallback. A full report's comparables carry no listing date either, so
 * the date is dropped unless asked for, to match what the pipeline does
 * with a full report.
 */
export interface ReportCompLike {
  listingID: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  accommodates: number;
  latitude: number;
  longitude: number;
  host_name: string;
  room_type: string;
  property_type?: string;
  minimum_nights: number;
  visible_review_count: number;
  reveiw_scores_rating: number;
  amenities: Record<string, boolean>;
  annual_revenue_ltm: number;
  avg_occupancy_rate_ltm: number;
  avg_booked_daily_rate_ltm: number;
  active_days_count_ltm: number;
  no_of_bookings_ltm: number;
  revenue_ltm_monthly: Record<string, number | null>;
  booked_daily_rate_ltm_monthly: Record<string, number | null>;
  occupancy_rate_ltm_monthly: Record<string, number | null>;
  added_on?: string;
}

export function toReportComp(l: CompListing, keepListingDate = false): ReportCompLike {
  return {
    listingID: String(l.listingID),
    name: l.name ?? 'Airbnb listing',
    bedrooms: bedroomsOf(l.bedrooms) ?? 0,
    bathrooms: l.bathrooms ?? 0,
    accommodates: l.accommodates ?? 0,
    latitude: l.latitude,
    longitude: l.longitude,
    host_name: l.host_name ?? '',
    room_type: l.room_type ?? 'entire_home',
    ...(l.property_type ? { property_type: l.property_type } : {}),
    minimum_nights: l.minimum_nights ?? 1,
    visible_review_count: l.visible_review_count ?? 0,
    reveiw_scores_rating: l.reveiw_scores_rating ?? 0,
    amenities: l.amenities ?? {},
    annual_revenue_ltm: l.annual_revenue_ltm ?? 0,
    avg_occupancy_rate_ltm: l.avg_occupancy_rate_ltm ?? 0,
    avg_booked_daily_rate_ltm: l.avg_booked_daily_rate_ltm ?? 0,
    active_days_count_ltm: l.active_days_count_ltm ?? 0,
    no_of_bookings_ltm: l.no_of_bookings_ltm ?? 0,
    revenue_ltm_monthly: {},
    booked_daily_rate_ltm_monthly: {},
    occupancy_rate_ltm_monthly: {},
    ...(keepListingDate && l.added_on ? { added_on: l.added_on } : {}),
  };
}

/**
 * The bounding box Airbtics' listings search takes, enclosing a circle of
 * `radiusKm` around the point (the circle itself is applied to the results).
 */
export function boxAround(lat: number, lng: number, radiusKm: number): { ne_lat: number; ne_lng: number; sw_lat: number; sw_lng: number } {
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { ne_lat: r(lat + dLat), ne_lng: r(lng + dLng), sw_lat: r(lat - dLat), sw_lng: r(lng - dLng) };
}

/** Airbtics' bedrooms filter: 1–5 as numbers, six or more as "6+"; a studio is left to the client-side test. */
export function bedroomsFilter(bedrooms: number): (number | string)[] | null {
  if (!Number.isInteger(bedrooms) || bedrooms <= 0) return null;
  return bedrooms >= 6 ? ['6+'] : [bedrooms];
}
