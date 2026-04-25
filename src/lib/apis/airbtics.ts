/**
 * Airbtics API — fetches short-term let revenue estimates + real nearby comparables.
 *
 * Base URL: https://crap0y5bx5.execute-api.us-east-2.amazonaws.com/prod
 * Auth: x-api-key header
 * Docs: https://documenter.getpostman.com/view/25155751/2sB3QRoSvW
 *
 * PRIMARY flow (report/all — $0.50, highest accuracy):
 *   1. POST report/all with lat/lng/bedrooms → returns report_id
 *   2. GET report?id=<id> → poll until comps_status === "success"
 *   3. Parse ~40 comparables with full LTM data (revenue, ADR, occupancy, monthly)
 *
 * FALLBACK flow (markets + bounds — ~$0.46):
 *   1. markets/search — find market_id from postcode/city ($0.01)
 *   2. markets/summary — bedroom-specific summary ($0.25)
 *   3. markets/metrics/revenue + occupancy ($0.40)
 *   4. listings/search/bounds — nearby comparables ($0.05)
 */

import type {
  ShortLetData,
  ShortLetComparable,
  DataQuality,
  Scenarios,
  LocationClass,
  AdrMultipliers,
  AnnualisationMeta,
} from '../types';

// ─── V2 Filters & Tiering ───────────────────────────────────────
// Non-residential types: deprioritised but not excluded
const NON_RESIDENTIAL_TYPES = [
  'lodge', 'cabin', 'chalet', 'boat', 'treehouse',
  'glamping', 'rv', 'tent', 'yurt', 'cave', 'mobile home',
];

// UK lat/lng bounds — properties outside this box are pollutants
const UK_BOUNDS = { minLat: 49, maxLat: 61, minLng: -8, maxLng: 2 };

// V2: Outlier ADR trimming threshold (retained for wasADRTrimmed meta reporting only)
const ADR_OUTLIER_SPREAD_THRESHOLD = 2.5;
const ADR_OUTLIER_TRIM_PERCENT = 0.15;

// ─── V3 Location classification ─────────────────────────────────
// UK major-city outward-code prefixes → treated as urban
const URBAN_POSTCODE_PREFIXES = new Set<string>([
  // Greater London
  'E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC',
  'BR', 'CR', 'DA', 'EN', 'HA', 'IG', 'KT', 'RM', 'SM', 'TW', 'UB', 'WD',
  // Core cities
  'B', 'M', 'LS', 'S', 'L', 'BS', 'EH', 'G', 'NE', 'NG', 'CF', 'LE', 'CV', 'BD',
]);

// UK coastal outward-code prefixes
const COASTAL_POSTCODE_PREFIXES = new Set<string>([
  'TR', 'PL', 'EX', 'TQ', 'BH', 'BN', 'CT', 'TN', 'PO', 'SO', 'SA', 'LL',
  'PH', 'AB', 'KW', 'TD', 'DG', 'PA', 'KA', 'ZE', 'HS', 'IV',
]);

// Default radius steps (km) per location class — rural properties start wider
const RADIUS_BY_CLASS: Record<LocationClass, number[]> = {
  urban:          [0.4, 0.8, 1.6],
  suburban:       [0.8, 1.6, 3.2],
  rural_village:  [4.0, 8.0, 16.0],
  rural_isolated: [8.0, 16.0, 32.0],
  coastal:        [6.0, 12.0, 20.0],
};

// UK STR seasonal fallback index (sums to 12.00) — blended market data
const UK_DEFAULT_SEASONAL_INDEX = [
  0.77, 0.70, 0.82, 0.90, 0.98, 1.21,
  1.31, 1.25, 1.09, 0.92, 0.75, 1.30,
];

// ─── V3 ADR multiplier tables ───────────────────────────────────
const LOCATION_ADR_MULT: Record<LocationClass, number> = {
  urban:          1.00,
  suburban:       1.05,
  rural_village:  1.22,
  rural_isolated: 1.32,
  coastal:        1.28,
};

const PROPERTY_TYPE_ADR_MULT: Record<string, number> = {
  flat:            1.00,
  apartment:       1.00,
  terraced:        1.05,
  terraced_house:  1.05,
  semi_detached:   1.08,
  'semi-detached_house': 1.08,
  detached:        1.14,
  detached_house:  1.14,
  bungalow:        1.10,
  cottage:         1.26,
  farmhouse:       1.32,
  barn_conversion: 1.38,
  unique:          1.45,
};

const OUTDOOR_ADR_MULT: Record<string, number> = {
  none:            1.00,
  small_garden:    1.08,
  balcony:         1.04,
  balcony_terrace: 1.04,
  garden:          1.08,
  large_garden:    1.14,
  hot_tub:         1.24,
  grounds:         1.20,
  large_grounds:   1.20,
  roof_terrace:    1.06,
};

const CONDITION_ADR_MULT: Record<string, number> = {
  below_average: 0.80,
  average:       1.00,
  good:          1.12,
  high:          1.24,
  very_high:     1.38,
  luxury:        1.38,
};

// Ramp-up uplift by review count (applied to annualised revenue per comp)
const RAMP_UPLIFT_BY_REVIEWS: { max: number; uplift: number }[] = [
  { max: 4,         uplift: 0.30 },
  { max: 9,         uplift: 0.18 },
  { max: 19,        uplift: 0.08 },
  { max: 49,        uplift: 0.03 },
  { max: Infinity,  uplift: 0.00 },
];

// Comp weight multiplier by review count (stacks with similarity weight)
const REVIEW_WEIGHT_MULT: { max: number; weight: number }[] = [
  { max: 4,         weight: 0.40 },
  { max: 9,         weight: 0.60 },
  { max: 19,        weight: 0.80 },
  { max: 49,        weight: 0.95 },
  { max: Infinity,  weight: 1.00 },
];

const BASE_URL = process.env.AIRBTICS_BASE_URL || 'https://crap0y5bx5.execute-api.us-east-2.amazonaws.com/prod';

const TARGET_COMPARABLES = 12;
const SEARCH_RADII_KM = [0.4, 0.8, 1.6, 2.4, 3.2, 4.8, 8.0]; // PMI-equivalent steps (0.25mi–5mi in km)
const REPORT_POLL_INTERVAL_MS = 2000;
const REPORT_POLL_MAX_MS = 25000; // 25 seconds (up from 15)

// "Good operator" uplift applied to market fallback data.
// Based on observed difference: report/all p60 is ~25% above market median.
const GOOD_OPERATOR_UPLIFT = 1.25;

// ─── In-memory cache for report IDs ─────────────────────────────
// Reading existing reports is FREE. Cache report_id by postcode+bedrooms
// so the same property only costs $0.50 once.
const reportCache = new Map<string, { reportId: string; expiresAt: number }>();
const REPORT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (reports don't change that fast)

// ─── In-memory cache for market_id lookups ──────────────────────
const marketIdCache = new Map<string, { id: number | null; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Clean up stale cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of marketIdCache) {
    if (now > entry.expiresAt) marketIdCache.delete(key);
  }
}, 600_000);

/**
 * Calculates distance in km between two lat/lng points using the Haversine formula.
 */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export interface ShortLetOptions {
  bathrooms?: number;
  hasParking?: boolean;
  parkingSpaces?: number;      // V3: stacked ADR multiplier input
  finishQuality?: string;
  outdoorSpace?: string;       // V3: stacked ADR multiplier input
  propertyType?: string;       // V3: stacked ADR multiplier input
  specialFeatures?: string[];  // V3: e.g. ['sea_views','hot_tub','near_events_venue']
}

export async function getShortLetData(
  postcode: string,
  bedrooms: number,
  guests: number,
  lat: number,
  lng: number,
  options?: ShortLetOptions,
): Promise<{ data: ShortLetData; quality: DataQuality }> {
  const apiKey = process.env.AIRBTICS_API_KEY;

  const lowQuality: DataQuality = {
    comparablesFound: 0, comparablesTarget: TARGET_COMPARABLES,
    searchRadiusKm: 0, searchBroadened: false, level: 'low',
    disclaimer: 'Limited data available for this area. This property may be in a unique or rural location, which can be advantageous for short-term letting. Book a web meeting with Stayful for a more detailed, personalised assessment.',
  };

  // V3 — Classify location once (used by pipeline + dynamic radius steps)
  const locationClass = classifyLocation(postcode);
  console.log(`[V3] locationClass=${locationClass} for postcode ${postcode}`);

  if (!apiKey) {
    console.log('AIRBTICS_API_KEY not set, using market estimates');
    return { data: generateMarketEstimate(bedrooms), quality: lowQuality };
  }

  // ── PRIMARY: Try report/all ($0.50, highest accuracy with real comps) ──
  let reportAllResult: { data: ShortLetData; quality: DataQuality } | null = null;
  try {
    const reportResult = await fetchReportAll(lat, lng, bedrooms, guests, apiKey, postcode, options?.bathrooms);
    if (reportResult) {
      console.log(`[Airbtics] report/all returned ${reportResult.comps.length} raw comps`);
      reportAllResult = buildDataFromReportComps(reportResult, bedrooms, guests, lat, lng, locationClass, options);

      // If we got 12+ quality comps, use the report result directly
      if (reportAllResult.quality.comparablesFound >= TARGET_COMPARABLES) {
        console.log(`[Airbtics] Using report/all result: ${reportAllResult.quality.comparablesFound} comps found`);
        return reportAllResult;
      }
      console.log(`[Airbtics] report/all only found ${reportAllResult.quality.comparablesFound}/${TARGET_COMPARABLES} comps - trying bounds expansion`);
    } else {
      console.log('[Airbtics] report/all returned null (credits exhausted or failed)');
    }
  } catch (err) {
    console.log('[Airbtics] report/all failed:', err);
  }

  // ── SECONDARY: Try bounds-based progressive radius expansion ──
  // This runs when report/all found < 12 comps OR failed entirely.
  // Uses PMI-style radius steps (0.4km to 8km) until 12 comps found.
  try {
    const marketsResult = await getShortLetDataFromMarkets(postcode, bedrooms, guests, lat, lng, apiKey, options?.finishQuality);

    // Pick the better result between report/all and markets
    // Prefer whichever found more comparables
    if (reportAllResult && reportAllResult.quality.comparablesFound > marketsResult.quality.comparablesFound) {
      console.log(`[Airbtics] Keeping report/all result (${reportAllResult.quality.comparablesFound} > ${marketsResult.quality.comparablesFound} comps)`);
      return reportAllResult;
    }
    console.log(`[Airbtics] Using markets flow result: ${marketsResult.quality.comparablesFound} comps`);
    return marketsResult;
  } catch (err) {
    console.log('[Airbtics] markets fallback failed:', err);
  }

  // ── LAST RESORT: Return report/all result even with few comps ──
  if (reportAllResult) {
    console.log('[Airbtics] Returning report/all result as last resort');
    return reportAllResult;
  }

  // ── FINAL FALLBACK: generic estimate ──
  console.log('[Airbtics] All paths failed - using generic market estimate');
  return { data: generateMarketEstimate(bedrooms), quality: lowQuality };
}

// ─── report/all comp shape ─────────────────────────────────────
interface ReportComp {
  listingID: string;
  name: string;
  bedrooms: string | number; // API returns string
  bathrooms: number;
  accommodates: number;
  latitude: number;
  longitude: number;
  host_name: string;
  room_type: string;
  property_type?: string; // Used for residential vs non-residential tiering
  minimum_nights: number;
  visible_review_count: number;
  reveiw_scores_rating: number; // API typo, 0-5 scale
  amenities: Record<string, boolean>;
  annual_revenue_ltm: number;
  avg_occupancy_rate_ltm: number; // 0-100
  avg_booked_daily_rate_ltm: number;
  active_days_count_ltm: number;
  no_of_bookings_ltm: number;
  revenue_ltm_monthly: Record<string, number>; // "YYYY-MM" → revenue
  booked_daily_rate_ltm_monthly: Record<string, number>;
  occupancy_rate_ltm_monthly: Record<string, number>;
  // V3: listing maturity date — present on bounds listings, may or may not be on report/all
  added_on?: string;
  created_date?: string;
  listed_date?: string;
}

// ─── V2 Helper functions ────────────────────────────────────────

/** V2 Step 3a: Remove any listing outside UK bounds */
function isUKListing(c: ReportComp): boolean {
  const lat = c.latitude;
  const lng = c.longitude;
  if (lat == null || lng == null) return true; // no coords — keep, can't verify
  return lat >= UK_BOUNDS.minLat && lat <= UK_BOUNDS.maxLat &&
         lng >= UK_BOUNDS.minLng && lng <= UK_BOUNDS.maxLng;
}

/** V2 Step 3d: Check if property type is residential */
function isResidential(c: ReportComp): boolean {
  const t = (c.property_type || c.room_type || '').toLowerCase();
  if (!t) return true; // unknown — treat as residential
  return !NON_RESIDENTIAL_TYPES.some(type => t.includes(type));
}

/** V2 Step 3e: Review tier — established listings have more reliable data */
function reviewTier(c: ReportComp): number {
  const r = c.visible_review_count || 0;
  if (r >= 10) return 1; // Tier A — established
  if (r >= 3)  return 2; // Tier B — some track record
  return 3;              // Tier C — new/unproven
}

/** V2 Step 3c: Tiered guest tolerance — exact → ±1 → ±2 → ±3 */
function filterByGuestsTiered(comps: ReportComp[], targetGuests: number): ReportComp[] {
  const tiers = [0, 1, 2, 3];
  for (const tolerance of tiers) {
    const filtered = comps.filter((c) => {
      const g = c.accommodates || 0;
      return g >= (targetGuests - tolerance) && g <= (targetGuests + tolerance);
    });
    if (filtered.length >= 12) return filtered;
    // Keep the widest tier result if smaller tiers don't yield enough
    if (tolerance === 3) return filtered.length > 0 ? filtered : comps;
  }
  return comps;
}

/** Whether ADR trimming was applied (for meta reporting) */
function wasADRTrimmed(comps: ReportComp[]): boolean {
  const adrs = comps.map(c => c.avg_booked_daily_rate_ltm || 0).filter(v => v > 0).sort((a, b) => a - b);
  return adrs.length >= 6 && (adrs[adrs.length - 1] / adrs[0]) > ADR_OUTLIER_SPREAD_THRESHOLD;
}

interface ReportAllResult {
  id: string;
  latitude: number;
  longitude: number;
  bedrooms: number;
  bathrooms: number;
  accommodates: number;
  radius: number;
  comps_status: string;
  comps: ReportComp[];
}

/**
 * Two-step report/all flow:
 * 1. POST to create report → report_id
 * 2. Poll GET until comps_status === "success"
 * Cost: $0.50 for POST, GET is free.
 */
async function fetchReportAll(
  lat: number,
  lng: number,
  bedrooms: number,
  guests: number,
  apiKey: string,
  postcode: string,
  formBathrooms?: number,
): Promise<ReportAllResult | null> {
  const accommodates = guests;
  const bathrooms = formBathrooms ?? Math.max(1, Math.ceil(bedrooms * 0.75));

  // Check cache first — reading existing reports is FREE
  const cacheKey = `${postcode.replace(/\s+/g, '').toUpperCase()}_${bedrooms}bed`;
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`Airbtics report/all: using cached report ${cached.reportId} (FREE)`);
    const cachedResult = await readReport(cached.reportId, apiKey);
    if (cachedResult) return cachedResult;
    // Cache miss (report deleted?) — fall through to create new one
  }

  // Step 1: Create report ($0.50)
  const reportBody = {
    latitude: lat,
    longitude: lng,
    bedrooms,
    bathrooms,
    accommodates,
    currency: 'GBP',
    country_code: 'GB',
  };
  console.log('[DEBUG] report/all POST body:', JSON.stringify(reportBody));

  const createRes = await fetch(`${BASE_URL}/report/all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(reportBody),
    cache: 'no-store',
  });

  console.log(`[DEBUG] report/all HTTP status: ${createRes.status}`);

  if (!createRes.ok) {
    console.error(`[DEBUG] Airbtics report/all POST failed HTTP ${createRes.status}`);
    return null;
  }

  const createData = await createRes.json();
  console.log('[DEBUG] report/all raw response:', JSON.stringify(createData).slice(0, 2000));

  if (createData.message === 'insufficient_credits') {
    console.log('[DEBUG] Airbtics: insufficient_credits for report/all — NO data returned');
    return null;
  }

  const reportId = createData?.message?.report_id;
  if (!reportId) {
    console.error('[DEBUG] Airbtics report/all: no report_id in response', createData);
    return null;
  }

  console.log(`Airbtics report/all: created report ${reportId}, polling...`);

  // Cache the report ID for 24h — future reads are FREE
  reportCache.set(cacheKey, { reportId, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });

  // Step 2: Poll for completion
  const startTime = Date.now();
  while (Date.now() - startTime < REPORT_POLL_MAX_MS) {
    await new Promise((r) => setTimeout(r, REPORT_POLL_INTERVAL_MS));

    const readRes = await fetch(`${BASE_URL}/report?id=${reportId}`, {
      headers: { 'x-api-key': apiKey },
      cache: 'no-store',
    });

    if (!readRes.ok) {
      console.error(`Airbtics report GET returned HTTP ${readRes.status}`);
      continue;
    }

    const readData = await readRes.json();
    console.log('[DEBUG] report/read raw response:', JSON.stringify(readData).slice(0, 1500));
    const report = readData?.message ?? readData;

    if ((report?.comps_status === 'success' || (Array.isArray(report?.comps) && report.comps.length > 0)) && Array.isArray(report.comps)) {
      console.log(`[DEBUG] report/all SUCCESS: comps_status="${report?.comps_status}", comps_count=${report.comps.length}`);
      if (report.comps.length > 0) {
        console.log('[DEBUG] First comp fields:', Object.keys(report.comps[0]).join(','));
      }
      return report as ReportAllResult;
    }

    console.log(`[DEBUG] report/all: comps_status="${report?.comps_status}", comps_length=${Array.isArray(report?.comps) ? report.comps.length : 'N/A'}, retrying...`);
  }

  console.error('[DEBUG] Airbtics report/all: TIMED OUT waiting for comps');
  return null;
}

/**
 * Reads an existing report by ID (FREE — no credit cost).
 */
async function readReport(reportId: string, apiKey: string): Promise<ReportAllResult | null> {
  const res = await fetch(`${BASE_URL}/report?id=${reportId}`, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const report = data?.message ?? data;
  if ((report?.comps_status === 'success' || (Array.isArray(report?.comps) && report.comps.length > 0)) && Array.isArray(report.comps)) {
    return report as ReportAllResult;
  }
  return null;
}

/**
 * Calculates the median of an array of numbers.
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Finish quality multipliers applied after median calculation. */
const FINISH_MULTIPLIERS: Record<string, number> = {
  'below_average': 0.75,
  'average': 1.0,
  'high': 1.15,
  'very_high': 1.30,
};

/** Days in each calendar month (non-leap year). */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ═══════════════════════════════════════════════════════════════════
// V3 HELPERS
// ═══════════════════════════════════════════════════════════════════

/** V3 — Classify location from UK postcode outward code. Defaults to 'suburban'. */
function classifyLocation(postcode: string | undefined): LocationClass {
  if (!postcode) return 'suburban';
  // Extract outward code letters (e.g. "SW1A 1AA" → "SW")
  const match = postcode.toUpperCase().match(/^([A-Z]{1,2})/);
  if (!match) return 'suburban';
  const prefix = match[1];
  if (URBAN_POSTCODE_PREFIXES.has(prefix)) return 'urban';
  if (COASTAL_POSTCODE_PREFIXES.has(prefix)) return 'coastal';
  // Unknown prefix = likely rural/smaller town — be conservative with 'rural_village'
  // Urban prefixes cover all major cities so anything else is probably rural/smalltown
  return 'rural_village';
}

/** V3 — Parse listing date field (supports multiple field names from Airbtics). */
function parseCompDate(comp: ReportComp): Date | null {
  const raw = comp.added_on || comp.created_date || comp.listed_date;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** V3 — Month diff (integer months between two dates, from ≤ to). */
function monthDiffMonths(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12
       + (to.getMonth() - from.getMonth());
}

/** V3 — Ramp-up revenue uplift based on review count (for new/developing listings). */
function getRampUplift(reviewCount: number | null | undefined): number {
  if (reviewCount == null) return 0.18; // unknown — assume developing
  for (const tier of RAMP_UPLIFT_BY_REVIEWS) {
    if (reviewCount <= tier.max) return tier.uplift;
  }
  return 0;
}

/** V3 — Per-comp weight multiplier from review count. */
function getReviewWeight(reviewCount: number | null | undefined): number {
  if (reviewCount == null) return 0.60;
  for (const tier of REVIEW_WEIGHT_MULT) {
    if (reviewCount <= tier.max) return tier.weight;
  }
  return 1.0;
}

/** V3 — Convert our monthly-revenue dict ("YYYY-MM"→revenue) to a 12-element array by calendar month. */
function revenueDictToArray(dict: Record<string, number> | undefined): number[] | null {
  if (!dict) return null;
  const out: number[] = new Array(12).fill(0);
  const counts: number[] = new Array(12).fill(0);
  for (const [key, value] of Object.entries(dict)) {
    const monthPart = key.split('-')[1];
    if (!monthPart) continue;
    const mi = parseInt(monthPart, 10) - 1;
    if (mi >= 0 && mi < 12 && typeof value === 'number' && value > 0) {
      out[mi] += value;
      counts[mi] += 1;
    }
  }
  for (let i = 0; i < 12; i++) {
    if (counts[i] > 0) out[i] /= counts[i];
  }
  // If >80% of months are zero, treat as missing
  const nonZero = out.filter(v => v > 0).length;
  if (nonZero < 3) return null;
  return out;
}

/**
 * V3 — Build a blended 12-point seasonal index.
 * Priority: 50% mature comps monthly average + 50% market (from first comp's dict) + fallback to UK default.
 */
function buildSeasonalIndex(comps: ReportComp[]): { index: number[]; source: string } {
  const now = new Date();
  const matureComps = comps.filter(c => {
    const d = parseCompDate(c);
    return d && monthDiffMonths(d, now) >= 12;
  });

  // Build mature comp curve
  let matureIndex: number[] | null = null;
  if (matureComps.length >= 3) {
    const totals = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    for (const comp of matureComps) {
      const arr = revenueDictToArray(comp.revenue_ltm_monthly);
      if (!arr) continue;
      for (let i = 0; i < 12; i++) {
        if (arr[i] > 0) {
          totals[i] += arr[i];
          counts[i] += 1;
        }
      }
    }
    const avgs = totals.map((t, i) => counts[i] > 0 ? t / counts[i] : 0);
    const avgTotal = avgs.reduce((s, v) => s + v, 0);
    if (avgTotal > 0 && avgs.filter(v => v > 0).length >= 6) {
      matureIndex = avgs.map(v => (v / avgTotal) * 12);
    }
  }

  // Build market curve from any comp with monthly occupancy data (used as proxy)
  let marketIndex: number[] | null = null;
  const totals2 = new Array(12).fill(0);
  const counts2 = new Array(12).fill(0);
  for (const comp of comps) {
    const arr = revenueDictToArray(comp.occupancy_rate_ltm_monthly);
    if (!arr) continue;
    for (let i = 0; i < 12; i++) {
      if (arr[i] > 0) {
        totals2[i] += arr[i];
        counts2[i] += 1;
      }
    }
  }
  const marketAvgs = totals2.map((t, i) => counts2[i] > 0 ? t / counts2[i] : 0);
  const marketTotal = marketAvgs.reduce((s, v) => s + v, 0);
  if (marketTotal > 0 && marketAvgs.filter(v => v > 0).length >= 6) {
    marketIndex = marketAvgs.map(v => (v / marketTotal) * 12);
  }

  if (matureIndex && marketIndex) {
    return {
      index: matureIndex.map((v, i) => v * 0.5 + marketIndex![i] * 0.5),
      source: 'mature_comps + airbtics_market',
    };
  }
  if (matureIndex) return { index: matureIndex, source: 'mature_comps' };
  if (marketIndex) return { index: marketIndex, source: 'airbtics_market' };
  return { index: [...UK_DEFAULT_SEASONAL_INDEX], source: 'uk_default_curve' };
}

/** V3 per-comp enrichment from annualiseComps. */
interface CompEnrichment {
  rawRevenue: number;
  annualisedRevenue: number;
  annualised: boolean;
  monthsLive: number | null;
  rampUplift: number;
  reviewWeight: number;
  seasonalCoverage: number | null;
}

/**
 * V3 — For each comp:
 *   1. Determine listing age from added_on/created_date
 *   2. If < 12 months: correct revenue using seasonal coverage fraction
 *   3. Apply ramp-up uplift based on review count
 *   4. Store per-comp review weight
 */
function annualiseComps(
  comps: ReportComp[],
  seasonalIndex: number[],
): Map<string, CompEnrichment> {
  const now = new Date();
  const indexTotal = seasonalIndex.reduce((s, v) => s + v, 0) || 12;
  const out = new Map<string, CompEnrichment>();

  for (const comp of comps) {
    const rawRevenue = comp.annual_revenue_ltm ?? 0;
    const reviews = comp.visible_review_count ?? null;
    const rampUplift = getRampUplift(reviews);
    const reviewWeight = getReviewWeight(reviews);
    const created = parseCompDate(comp);

    if (!created) {
      // No date — treat as mature, apply ramp-up uplift only
      out.set(comp.listingID, {
        rawRevenue,
        annualisedRevenue: rawRevenue * (1 + rampUplift),
        annualised: false,
        monthsLive: null,
        rampUplift,
        reviewWeight,
        seasonalCoverage: null,
      });
      continue;
    }

    const ageMonths = monthDiffMonths(created, now);
    if (ageMonths >= 12) {
      out.set(comp.listingID, {
        rawRevenue,
        annualisedRevenue: rawRevenue * (1 + rampUplift),
        annualised: false,
        monthsLive: ageMonths,
        rampUplift,
        reviewWeight,
        seasonalCoverage: null,
      });
      continue;
    }

    // Immature — seasonal annualisation
    const activeMonths: number[] = [];
    for (let i = 0; i < ageMonths; i++) {
      const d = new Date(created.getFullYear(), created.getMonth() + i, 1);
      activeMonths.push(d.getMonth());
    }
    const activeCoverage = activeMonths.reduce(
      (s, m) => s + (seasonalIndex[m] || 1),
      0,
    );
    const seasonalCoverage = Math.max(activeCoverage / indexTotal, 0.05);
    const annualisedRaw = rawRevenue / seasonalCoverage;
    out.set(comp.listingID, {
      rawRevenue,
      annualisedRevenue: annualisedRaw * (1 + rampUplift),
      annualised: true,
      monthsLive: ageMonths,
      rampUplift,
      reviewWeight,
      seasonalCoverage,
    });
  }
  return out;
}

/** V3 — Per-comp similarity weight: distance × bedroom match × type × review weight. */
function compSimilarityWeight(
  comp: ReportComp,
  targetBeds: number | null,
  lat: number,
  lng: number,
  reviewWeight: number,
): number {
  // Distance score — inverse (closer = heavier)
  const distMi = haversineKm(lat, lng, comp.latitude, comp.longitude) * 0.621371;
  const distScore = 1 / (1 + distMi);

  // Bedroom match
  const compBeds = typeof comp.bedrooms === 'string'
    ? parseInt(comp.bedrooms, 10)
    : (comp.bedrooms ?? 0);
  const bedroomScore = (targetBeds != null && compBeds > 0)
    ? (compBeds === targetBeds ? 1.0 : 0.7)
    : 1.0;

  // Residential preference
  const typeScore = isResidential(comp) ? 1.2 : 0.85;

  return distScore * bedroomScore * typeScore * reviewWeight;
}

/** V3 — Weighted ADR from selected comps using similarity × review weights. */
function calculateWeightedADR(
  comps: ReportComp[],
  enrichment: Map<string, CompEnrichment>,
  targetBeds: number,
  lat: number,
  lng: number,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const comp of comps) {
    const adr = comp.avg_booked_daily_rate_ltm ?? 0;
    if (!adr || adr <= 0) continue;
    const e = enrichment.get(comp.listingID);
    const reviewW = e?.reviewWeight ?? 1.0;
    const weight = compSimilarityWeight(comp, targetBeds, lat, lng, reviewW);
    weightedSum += adr * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    // Fallback to median
    const adrs = comps.map(c => c.avg_booked_daily_rate_ltm ?? 0).filter(v => v > 0);
    return calculateMedian(adrs);
  }
  return weightedSum / totalWeight;
}

/** V3 — Weighted occupancy (0–1 scale) using same similarity weights. */
function calculateWeightedOccupancy(
  comps: ReportComp[],
  enrichment: Map<string, CompEnrichment>,
  lat: number,
  lng: number,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const comp of comps) {
    const occ = (comp.avg_occupancy_rate_ltm ?? 0) / 100;
    if (occ <= 0) continue;
    const e = enrichment.get(comp.listingID);
    const reviewW = e?.reviewWeight ?? 1.0;
    const weight = compSimilarityWeight(comp, null, lat, lng, reviewW);
    weightedSum += occ * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    const occs = comps.map(c => (c.avg_occupancy_rate_ltm ?? 0) / 100).filter(v => v > 0);
    return calculateMedian(occs);
  }
  return weightedSum / totalWeight;
}

/** V3 — Stacked ADR feature multiplier (location × property type × outdoor × parking × condition + special bonus). */
interface AdrMultInput {
  locationClass: LocationClass;
  propertyType?: string;
  outdoorSpace?: string;
  parkingSpaces?: number;
  finishQuality?: string;
  specialFeatures?: string[];
}

interface AdrMultOutput {
  total: number;
  breakdown: {
    locMult: number;
    propTypeMult: number;
    outdoorMult: number;
    parkingMult: number;
    conditionMult: number;
    specialBonus: number;
  };
}

function getADRMultiplier(input: AdrMultInput): AdrMultOutput {
  const locMult = LOCATION_ADR_MULT[input.locationClass] ?? 1.0;

  const propKey = (input.propertyType || '').toLowerCase().replace(/[\s-]/g, '_');
  const propTypeMult = PROPERTY_TYPE_ADR_MULT[propKey] ?? 1.05;

  const outdoorKey = (input.outdoorSpace || 'none').toLowerCase();
  const outdoorMult = OUTDOOR_ADR_MULT[outdoorKey] ?? 1.0;

  const conditionMult = CONDITION_ADR_MULT[(input.finishQuality || 'average').toLowerCase()] ?? 1.0;

  const parkingNum = input.parkingSpaces ?? 0;
  const parkingMult = parkingNum >= 2 ? 1.10 : parkingNum === 1 ? 1.06 : 1.0;

  let specialBonus = 0;
  const sf = input.specialFeatures ?? [];
  if (sf.includes('sea_views') || sf.includes('lake_views')) specialBonus += 0.15;
  if (sf.includes('hot_tub')) specialBonus += 0.20;
  if (sf.includes('ev_charging')) specialBonus += 0.04;
  if (sf.includes('near_events_venue')) specialBonus += 0.08;
  if (sf.includes('annexe') || sf.includes('games_room')) specialBonus += 0.06;

  const total = (locMult * propTypeMult * outdoorMult * parkingMult * conditionMult) + specialBonus;

  return {
    total,
    breakdown: { locMult, propTypeMult, outdoorMult, parkingMult, conditionMult, specialBonus },
  };
}

/**
 * Builds ShortLetData + DataQuality from report/all comps.
 * Filters by guest capacity (within +/-2 of user's guest count),
 * uses MEDIAN stats across all filtered comps, then applies finish quality multiplier.
 */
/**
 * V3 — Build short-let data from report/all comps.
 *
 * Pipeline (per V3 spec):
 *   3a. Filter non-UK lat/lng
 *   3b. Filter zero-revenue comps
 *   3c. Tiered guest tolerance (exact → ±1 → ±2 → ±3)
 *   3d. Property type tiering (residential preferred)
 *   3e. Review count tiering (established preferred)
 *   3f. Seasonal index + comp annualisation (NEW): correct revenue for listings <12mo;
 *       apply ramp-up uplift for low-review comps.
 *   4.  Sort by tier then distance, take top 12
 *   5.  Weighted ADR + weighted occupancy (NEW — replaces median)
 *   6.  Store quality multiplier (NOT applied to headline — only to scenarios)
 *   7.  Build separate ADR + occupancy seasonal multipliers from market data
 *   8.  Monthly forecast: ADR × occ × days_in_month
 *   8b. Stacked ADR feature multiplier (NEW — applies location/propType/outdoor/parking/condition/special)
 *   9.  Scenarios: worst=quality-adj, base=worst+5% occ, best=quality-adj + 5% occ + 5% ADR
 *       (V3 fix: was returning worstForecast — copy-paste bug)
 */
function buildDataFromReportComps(
  report: ReportAllResult,
  bedrooms: number,
  guests: number,
  lat: number,
  lng: number,
  locationClass: LocationClass,
  options?: ShortLetOptions,
): { data: ShortLetData; quality: DataQuality } {
  const hasParking = options?.hasParking;
  const finishQuality = options?.finishQuality;
  const allComps = report.comps || [];
  console.log(`[V2] buildDataFromReportComps: ${allComps.length} raw comps`);

  // ── Step 3a: Non-UK lat/lng filter ──
  const ukComps = allComps.filter(isUKListing);
  const nonUKRemoved = allComps.length - ukComps.length;
  if (nonUKRemoved > 0) console.log(`[V2] 3a: Removed ${nonUKRemoved} non-UK listings`);

  // ── Step 3b: Revenue > 0 filter ──
  const withRevenue = ukComps.filter((c) => (c.annual_revenue_ltm ?? 0) > 0);
  console.log(`[V2] 3b: ${withRevenue.length} comps with revenue`);

  // ── Step 3c: Tiered guest tolerance ──
  const guestFiltered = filterByGuestsTiered(withRevenue, guests);
  console.log(`[V2] 3c: ${guestFiltered.length} comps after guest tiered filter (target: ${guests})`);

  // ── Step 3d: Property type tiering (residential first) ──
  const residential = guestFiltered.filter(isResidential);
  const nonResidential = guestFiltered.filter((c) => !isResidential(c));
  const tieredByType = [...residential, ...nonResidential];
  console.log(`[V2] 3d: ${residential.length} residential, ${nonResidential.length} non-residential`);

  // ── Step 3e: Parking preference (pre-existing behaviour, preserved) ──
  if (hasParking) {
    const hasParkingFn = (c: ReportComp): boolean => {
      if (!c.amenities) return false;
      return !!(c.amenities.parking || c.amenities.free_parking ||
                c.amenities['Free parking on premises'] || c.amenities['free_parking_on_premises']);
    };
    tieredByType.sort((a, b) => {
      const aP = hasParkingFn(a) ? 1 : 0;
      const bP = hasParkingFn(b) ? 1 : 0;
      return bP - aP;
    });
  }

  // ── Step 4: Sort by review tier first (A → B → C), then distance ──
  const sorted = [...tieredByType].sort((a, b) => {
    const tierDiff = reviewTier(a) - reviewTier(b);
    if (tierDiff !== 0) return tierDiff;
    const distA = haversineKm(lat, lng, a.latitude, a.longitude);
    const distB = haversineKm(lat, lng, b.latitude, b.longitude);
    return distA - distB;
  });

  const top12 = sorted.slice(0, TARGET_COMPARABLES);
  console.log(`[V3] Selected top ${top12.length} comps`);

  // ── Handle no-comps edge case ──
  if (top12.length === 0) {
    console.log(`[V2] No comps matched — falling back to generic estimate`);
    const estimate = generateMarketEstimate(bedrooms);
    return {
      data: estimate,
      quality: {
        comparablesFound: 0,
        comparablesTarget: TARGET_COMPARABLES,
        searchRadiusKm: report.radius ? report.radius / 1000 : 0,
        searchBroadened: false,
        level: 'low',
        disclaimer: `No comparable properties accommodating ~${guests} guests were found. Market-level estimates have been used. Book a web meeting with Stayful for accurate, personalised revenue projections.`,
      },
    };
  }

  // ── Step 3f (V3): Build seasonal index + annualise comps ──
  // Fixes the "6-months-live comp with £20k revenue being read as £20k/year" bug:
  // immature listings are revenue-corrected for seasonal coverage, then ramp-up
  // uplift is applied based on review count.
  const { index: seasonalIndex, source: seasonalSource } = buildSeasonalIndex(top12);
  const enrichment = annualiseComps(top12, seasonalIndex);
  const annualisedCount = Array.from(enrichment.values()).filter(e => e.annualised).length;
  console.log(`[V3] Step 3f: seasonalSource=${seasonalSource}, comps_annualised=${annualisedCount}/${top12.length}`);

  // Swap annualised revenue onto the comps used for downstream weighting and comparables output.
  const enrichedComps: ReportComp[] = top12.map(c => {
    const e = enrichment.get(c.listingID);
    if (!e) return c;
    return { ...c, annual_revenue_ltm: Math.round(e.annualisedRevenue) };
  });

  // Build comparables for UI using enriched (annualised) values.
  const comparables: ShortLetComparable[] = enrichedComps.map((c): ShortLetComparable => {
    const e = enrichment.get(c.listingID);
    const distance = haversineKm(lat, lng, c.latitude, c.longitude);
    // listingAge: show months-live / 12 as decimal years when <12 months, else rounded years.
    let listingAge = 0;
    if (e?.monthsLive != null) {
      listingAge = Math.round((e.monthsLive / 12) * 10) / 10;
    }
    return {
      title: c.name || 'Airbnb Listing',
      url: `https://www.airbnb.co.uk/rooms/${c.listingID}`,
      bedrooms: typeof c.bedrooms === 'string' ? parseInt(c.bedrooms, 10) : (c.bedrooms ?? 0),
      accommodates: c.accommodates ?? 0,
      averageDailyRate: Math.round(c.avg_booked_daily_rate_ltm ?? 0),
      occupancyRate: Math.round(c.avg_occupancy_rate_ltm ?? 0) / 100,
      annualRevenue: Math.round(c.annual_revenue_ltm ?? 0),
      distance,
      rating: Math.floor((c.reveiw_scores_rating ?? 0) * 10) / 10,
      reviewCount: c.visible_review_count ?? 0,
      listingAge,
      daysAvailable: c.active_days_count_ltm ?? 0,
    };
  });

  // ── Step 5 (V3): Weighted ADR + weighted occupancy ──
  // Replaces V2's median + outlier trimming. Distance, bedroom-match, property-type,
  // and review-count all contribute to each comp's weight.
  const base_ADR = calculateWeightedADR(enrichedComps, enrichment, bedrooms, lat, lng);
  const base_occ = calculateWeightedOccupancy(enrichedComps, enrichment, lat, lng);
  const trimmed = wasADRTrimmed(enrichedComps);
  console.log(`[V3] Step 5: base_ADR=£${base_ADR.toFixed(0)}, base_occ=${(base_occ*100).toFixed(0)}% (weighted)`);

  // ── Step 6: Quality multiplier (stored for scenarios, NOT applied to headline) ──
  const qualityMultiplier = FINISH_MULTIPLIERS[finishQuality || 'average'] ?? 1.0;
  console.log(`[V3] Step 6: quality multiplier = ${qualityMultiplier} (${finishQuality || 'average'})`);

  // ── Step 7: Separate ADR + occupancy seasonal curves from comp monthly data ──
  const seasonalADRMultiplier = buildSeasonalMultipliers(enrichedComps, 'booked_daily_rate_ltm_monthly');
  const seasonalOccMultiplier = buildSeasonalMultipliers(enrichedComps, 'occupancy_rate_ltm_monthly');

  // ── Step 8b (V3): Stacked ADR feature multiplier (the big form-fields fix) ──
  // This is what closes the PMI gap on rural, coastal, and unique properties —
  // location class, property type, outdoor space, parking, finish, and special
  // features all stack multiplicatively onto the headline ADR.
  const { total: adrMultiplier, breakdown: multBreakdown } = getADRMultiplier({
    locationClass,
    propertyType: options?.propertyType,
    outdoorSpace: options?.outdoorSpace,
    parkingSpaces: options?.parkingSpaces,
    finishQuality,
    specialFeatures: options?.specialFeatures,
  });
  const adjusted_ADR = base_ADR * adrMultiplier;
  console.log(`[V3] Step 8b: adrMultiplier=${adrMultiplier.toFixed(3)} (loc=${multBreakdown.locMult} type=${multBreakdown.propTypeMult} out=${multBreakdown.outdoorMult} park=${multBreakdown.parkingMult} cond=${multBreakdown.conditionMult} special=${multBreakdown.specialBonus.toFixed(2)}) → adjusted_ADR=£${adjusted_ADR.toFixed(0)}`);

  // ── Step 8: Build 12-month forecast ──
  //    Formula: adjusted_ADR × seasonal_ADR × occ × seasonal_occ × days_in_month
  const buildForecast = (adr: number, occ: number) => {
    return DAYS_IN_MONTH.map((days, i) => {
      const monthlyADR = adr * seasonalADRMultiplier[i];
      const monthlyOcc = Math.min(occ * seasonalOccMultiplier[i], 1.0);
      const revenue = Math.round(monthlyADR * monthlyOcc * days);
      return { adr: Math.round(monthlyADR), occupancy: Math.round(monthlyOcc * 100), revenue };
    });
  };

  const headlineForecast = buildForecast(adjusted_ADR, base_occ);
  const headlineAnnualRevenue = headlineForecast.reduce((s, m) => s + m.revenue, 0);

  // ── Step 9 (V3 FIX): Scenarios (worst/base/best) ──
  // V2 had a copy-paste bug where `bestForecast = worstForecast`. V3 properly
  // differentiates: best adds +5% ADR and +5% occupancy on top of quality multiplier.
  const worstForecast = buildForecast(adjusted_ADR * qualityMultiplier, base_occ);
  const baseCaseForecast = buildForecast(adjusted_ADR * qualityMultiplier, Math.min(base_occ * 1.05, 1.0));
  const bestForecast = buildForecast(adjusted_ADR * qualityMultiplier * 1.05, Math.min(base_occ * 1.05, 1.0));

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buildScenarioMonthly = (f: ReturnType<typeof buildForecast>) =>
    f.map((m, i) => ({ label: MONTHS[i], adr: m.adr, occupancy: m.occupancy, revenue: m.revenue }));

  const scenarios: Scenarios = {
    worst: {
      annualRevenue: worstForecast.reduce((s, m) => s + m.revenue, 0),
      averageDailyRate: Math.round(worstForecast.reduce((s, m) => s + m.adr, 0) / 12),
      occupancyPercent: Math.round(worstForecast.reduce((s, m) => s + m.occupancy, 0) / 12),
      monthly: buildScenarioMonthly(worstForecast),
    },
    base: {
      annualRevenue: baseCaseForecast.reduce((s, m) => s + m.revenue, 0),
      averageDailyRate: Math.round(baseCaseForecast.reduce((s, m) => s + m.adr, 0) / 12),
      occupancyPercent: Math.round(baseCaseForecast.reduce((s, m) => s + m.occupancy, 0) / 12),
      monthly: buildScenarioMonthly(baseCaseForecast),
    },
    best: {
      annualRevenue: bestForecast.reduce((s, m) => s + m.revenue, 0),
      averageDailyRate: Math.round(bestForecast.reduce((s, m) => s + m.adr, 0) / 12),
      occupancyPercent: Math.round(bestForecast.reduce((s, m) => s + m.occupancy, 0) / 12),
      monthly: buildScenarioMonthly(bestForecast),
    },
  };

  // ── Headline figures: PMI-pure (no quality multiplier) ──
  // Note: the REPORT UI currently uses headline (report/all accuracy).
  // Scenarios layer is available for future UI integration.
  const monthlyRevenue = headlineForecast.map((m) => m.revenue);
  const headlineAverageADR = Math.round(headlineForecast.reduce((s, m) => s + m.adr, 0) / 12);
  const headlineOccupancy = headlineForecast.reduce((s, m) => s + m.occupancy, 0) / 12 / 100;

  // Cross-check: ADR × occ × 365 should ≈ annual_revenue (±5%)
  const crossCheck = Math.round(headlineAverageADR * headlineOccupancy * 365);
  const divergence = Math.abs(crossCheck - headlineAnnualRevenue) / headlineAnnualRevenue;
  if (divergence > 0.05) {
    console.warn(`[V2] Cross-check divergence ${(divergence*100).toFixed(1)}%: calc=${crossCheck}, forecast=${headlineAnnualRevenue}`);
  }

  const activeListings = top12.length;
  const searchRadiusKm = report.radius ? Math.round(report.radius / 1000 * 100) / 100 : 0;

  // ── Data quality assessment ──
  const comparablesFound = comparables.length;
  let qualityLevel: DataQuality['level'];
  let disclaimer: string | null = null;

  if (comparablesFound >= TARGET_COMPARABLES) {
    qualityLevel = 'high';
  } else if (comparablesFound >= 6) {
    qualityLevel = 'moderate';
    disclaimer = `${comparablesFound} comparable properties (accommodating ~${guests} guests) were found within ${searchRadiusKm}km. Data accuracy may be slightly reduced. This could indicate a unique property type for the area, which is often advantageous for short-term letting.`;
  } else {
    qualityLevel = 'low';
    disclaimer = comparablesFound > 0
      ? `Only ${comparablesFound} comparable properties (accommodating ~${guests} guests) were found within ${searchRadiusKm}km. This area may be rural or the property type may be unique, both of which can be highly advantageous for short-term letting due to low competition. Book a web meeting with Stayful for a detailed, personalised assessment.`
      : `No comparable properties accommodating ~${guests} guests were found. Market-level estimates have been used. Book a web meeting with Stayful for accurate, personalised revenue projections.`;
  }

  // ── V3 metadata for UI + debugging ──
  const adrMultipliers: AdrMultipliers = {
    total: parseFloat(adrMultiplier.toFixed(3)),
    location: parseFloat(multBreakdown.locMult.toFixed(3)),
    propertyType: parseFloat(multBreakdown.propTypeMult.toFixed(3)),
    outdoorSpace: parseFloat(multBreakdown.outdoorMult.toFixed(3)),
    parking: parseFloat(multBreakdown.parkingMult.toFixed(3)),
    condition: parseFloat(multBreakdown.conditionMult.toFixed(3)),
    specialFeatures: parseFloat(multBreakdown.specialBonus.toFixed(3)),
    baseAdrPreMult: Math.round(base_ADR),
    finalAdr: Math.round(adjusted_ADR),
  };

  const annualisationMeta: AnnualisationMeta = {
    compsAnnualised: annualisedCount,
    compsMature: top12.length - annualisedCount,
    seasonalDataSource: seasonalSource,
  };

  // Quiet the unused-binding linter — kept for future meta reporting
  void trimmed;

  return {
    data: {
      annualRevenue: Math.round(headlineAnnualRevenue),
      monthlyRevenue: padTo12Months(monthlyRevenue),
      occupancyRate: Math.round(headlineOccupancy * 100) / 100,
      averageDailyRate: headlineAverageADR,
      activeListings,
      comparables,
      scenarios,
      locationClass,
      adrMultipliers,
      annualisationMeta,
    },
    quality: {
      comparablesFound,
      comparablesTarget: TARGET_COMPARABLES,
      searchRadiusKm,
      searchBroadened: false,
      level: qualityLevel,
      disclaimer,
    },
  };
}

/**
 * Extracts real monthly revenue from comps' revenue_ltm_monthly fields.
 * Averages across comps, maps "YYYY-MM" keys to calendar months (Jan=0..Dec=11).
 * Returns exactly 12 values in Jan..Dec order.
 */
function extractMonthlyFromComps(comps: ReportComp[]): number[] {
  // Collect all monthly data per calendar month (0=Jan .. 11=Dec)
  const monthTotals: number[] = new Array(12).fill(0);
  const monthCounts: number[] = new Array(12).fill(0);

  for (const comp of comps) {
    if (!comp.revenue_ltm_monthly) continue;
    for (const [key, value] of Object.entries(comp.revenue_ltm_monthly)) {
      // key is "YYYY-MM"
      const monthPart = key.split('-')[1];
      if (!monthPart) continue;
      const monthIndex = parseInt(monthPart, 10) - 1; // "01" → 0 (Jan)
      if (monthIndex >= 0 && monthIndex < 12 && typeof value === 'number') {
        monthTotals[monthIndex] += value;
        monthCounts[monthIndex]++;
      }
    }
  }

  // Average each month
  return monthTotals.map((total, i) =>
    monthCounts[i] > 0 ? Math.round(total / monthCounts[i]) : 0,
  );
}

/**
 * Builds seasonal multipliers from comp monthly data.
 * multiplier[month] = monthAverage / annualAverage
 * Falls back to typical UK seasonal pattern if no real data.
 */
function buildSeasonalMultipliers(
  comps: ReportComp[],
  monthlyField: 'booked_daily_rate_ltm_monthly' | 'occupancy_rate_ltm_monthly',
): number[] {
  const monthTotals: number[] = new Array(12).fill(0);
  const monthCounts: number[] = new Array(12).fill(0);

  for (const comp of comps) {
    const monthlyData = comp[monthlyField];
    if (!monthlyData) continue;
    for (const [key, value] of Object.entries(monthlyData)) {
      const monthPart = key.split('-')[1];
      if (!monthPart) continue;
      const monthIndex = parseInt(monthPart, 10) - 1;
      if (monthIndex >= 0 && monthIndex < 12 && typeof value === 'number' && value > 0) {
        monthTotals[monthIndex] += value;
        monthCounts[monthIndex]++;
      }
    }
  }

  const monthAverages = monthTotals.map((total, i) =>
    monthCounts[i] > 0 ? total / monthCounts[i] : 0,
  );

  const validMonths = monthAverages.filter(v => v > 0);
  if (validMonths.length < 6) {
    // Not enough real data, use default UK seasonal pattern
    return [0.82, 0.85, 0.95, 1.00, 1.08, 1.18, 1.25, 1.22, 1.10, 0.98, 0.88, 0.80];
  }

  const annualAverage = validMonths.reduce((s, v) => s + v, 0) / validMonths.length;
  return monthAverages.map(v => v > 0 ? v / annualAverage : 1.0);
}

/**
 * FALLBACK: Original markets/summary + metrics + bounds flow.
 * Used when report/all fails or returns no data.
 */
async function getShortLetDataFromMarkets(
  postcode: string,
  bedrooms: number,
  guests: number,
  lat: number,
  lng: number,
  apiKey: string,
  finishQuality?: string,
): Promise<{ data: ShortLetData; quality: DataQuality }> {
  const lowQuality: DataQuality = {
    comparablesFound: 0, comparablesTarget: TARGET_COMPARABLES,
    searchRadiusKm: 0, searchBroadened: false, level: 'low',
    disclaimer: 'Limited data available for this area. This property may be in a unique or rural location, which can be advantageous for short-term letting. Book a web meeting with Stayful for a more detailed, personalised assessment.',
  };

  // Step 1: Find market ID from postcode area (cached)
  const marketId = await findMarketId(postcode, apiKey);
  if (!marketId) {
    console.log('Airbtics: no market found for postcode, using estimates');
    return { data: generateMarketEstimate(bedrooms), quality: lowQuality };
  }

  // Step 2: Fetch ALL data in parallel for maximum accuracy ($0.70 total)
  // summary ($0.25) + revenue ($0.20) + occupancy ($0.20) + listings ($0.05)
  const [summaryData, revenueData, occupancyData, listingsData] = await Promise.allSettled([
    fetchMarketSummary(marketId, bedrooms, apiKey),
    fetchMetric('revenue', marketId, bedrooms, apiKey, 'GBP'),
    fetchMetric('occupancy', marketId, bedrooms, apiKey),
    fetchNearbyListings(lat, lng, apiKey),
  ]);

  const summary = summaryData.status === 'fulfilled' ? summaryData.value : null;
  const revenue = revenueData.status === 'fulfilled' ? revenueData.value : [];
  const occupancy = occupancyData.status === 'fulfilled' ? occupancyData.value : [];
  const listingsResult = listingsData.status === 'fulfilled' ? listingsData.value : null;

  // Check if summary has real data (not null values)
  const summaryHasData = summary && summary.revenue != null && summary.revenue > 0;

  // If no monthly data AND no useful summary, fall back to estimates
  if (revenue.length === 0 && !summaryHasData) {
    console.log('Airbtics: no data available, using market estimates');
    return { data: generateMarketEstimate(bedrooms), quality: lowQuality };
  }

  // Use summary as primary source (bedroom-specific, always accurate)
  // Monthly metrics as secondary for seasonal breakdown
  const summaryRevenue = summary?.revenue ?? 0;
  const summaryOccupancy = summary?.occupancy ? summary.occupancy / 100 : 0;
  const summaryAdr = summary?.average_daily_rate ?? 0;

  // Monthly breakdown from metrics (if available), otherwise distribute summary evenly with seasonal weighting
  let monthlyRevenue: number[];
  let avgOccupancy: number;

  if (revenue.length > 0) {
    monthlyRevenue = extractLast12Months(revenue, 'p50');
    const monthlyOccupancy = extractLast12Months(occupancy, 'p50');
    avgOccupancy = monthlyOccupancy.length > 0
      ? monthlyOccupancy.reduce((a, b) => a + b, 0) / monthlyOccupancy.length / 100
      : summaryOccupancy || 0.65;
  } else {
    // Use summary annual revenue distributed with seasonal weighting
    const base = (summaryRevenue || generateMarketEstimate(bedrooms).annualRevenue) / 12;
    const seasonalMultipliers = [0.82, 0.85, 0.95, 1.00, 1.08, 1.18, 1.25, 1.22, 1.10, 0.98, 0.88, 0.80];
    monthlyRevenue = seasonalMultipliers.map(m => Math.round(base * m));
    avgOccupancy = summaryOccupancy || 0.65;
  }

  // Apply finish quality multiplier (same as report/all path)
  const qualityMultiplier = FINISH_MULTIPLIERS[finishQuality || 'high'] ?? 1.15;

  // Apply guest-count adjustment: market data is for median guest count (~4)
  // Larger properties (more guests) command proportionally more revenue
  // Scale linearly: +12% per guest above 4 (capped at 1.5x for 8+ guests)
  const guestAdjustment = Math.min(1 + (Math.max(0, guests - 4) * 0.12), 1.5);

  const rawRevenue = summaryRevenue || monthlyRevenue.reduce((a, b) => a + b, 0);
  let annualRevenue = Math.round(rawRevenue * qualityMultiplier * guestAdjustment);
  let derivedAdr = Math.round((summaryAdr || Math.round(rawRevenue / 12 / ((avgOccupancy || 0.65) * 30))) * qualityMultiplier * guestAdjustment);

  monthlyRevenue = monthlyRevenue.map(m => Math.round(m * qualityMultiplier * guestAdjustment));

  // ── Rule of 12: Try to find 12 comparables, broadening search if needed ──
  let comparables: ShortLetComparable[] = [];
  let activeListings = 0;
  let searchRadiusKm = SEARCH_RADII_KM[0];
  let searchBroadened = false;

  // First attempt uses the initial bounds result
  if (listingsResult) {
    const result = extractComparables(listingsResult, guests, lat, lng);
    comparables = result.comparables;
    activeListings = result.totalMatches;
  }

  // If we have fewer than 12, try broader radii (PMI progressive expansion)
  if (comparables.length < TARGET_COMPARABLES) {
    for (let i = 1; i < SEARCH_RADII_KM.length; i++) {
      const radiusKm = SEARCH_RADII_KM[i];
      console.log(`Airbtics: only ${comparables.length}/${TARGET_COMPARABLES} comparables, broadening to ${radiusKm}km`);
      searchBroadened = true;
      searchRadiusKm = radiusKm;

      const broaderResult = await fetchNearbyListings(lat, lng, apiKey, radiusKm);
      if (broaderResult) {
        const result = extractComparables(broaderResult, guests, lat, lng);
        comparables = result.comparables;
        activeListings = result.totalMatches;
        if (comparables.length >= TARGET_COMPARABLES) break;
      }
    }
  } else {
    searchRadiusKm = SEARCH_RADII_KM[0];
  }

  // Cap at 12 comparables
  comparables = comparables.slice(0, TARGET_COMPARABLES);

  // Use summary active_listings_count as fallback
  if (activeListings === 0 && summary?.active_listings_count) {
    activeListings = summary.active_listings_count;
  }

  // ── Top-5 performer override ──
  if (comparables.length >= 5) {
    const sorted = [...comparables].sort((a, b) => b.annualRevenue - a.annualRevenue);
    const top5 = sorted.slice(0, 5);
    const top5Revenue = Math.round(top5.reduce((s, c) => s + c.annualRevenue, 0) / 5);
    const top5Adr = Math.round(top5.reduce((s, c) => s + c.averageDailyRate, 0) / 5);
    const top5Occupancy = top5.reduce((s, c) => s + c.occupancyRate, 0) / 5;

    const ratio = top5Revenue / (annualRevenue || 1);
    monthlyRevenue = monthlyRevenue.map((m) => Math.round(m * ratio));

    annualRevenue = top5Revenue;
    avgOccupancy = top5Occupancy;
    derivedAdr = top5Adr;
  }

  // ── Build data quality assessment ──
  const comparablesFound = comparables.length;
  let qualityLevel: DataQuality['level'];
  let disclaimer: string | null = null;

  if (comparablesFound >= TARGET_COMPARABLES) {
    qualityLevel = 'high';
  } else if (comparablesFound >= 6) {
    qualityLevel = 'moderate';
    disclaimer = `${comparablesFound} comparable properties (accommodating ~${guests} guests) were found within ${searchRadiusKm}km after expanding the search. Data accuracy may be slightly reduced. This could indicate a unique property type for the area, which is often advantageous for short-term letting.`;
  } else if (comparablesFound > 0) {
    qualityLevel = 'low';
    disclaimer = `Only ${comparablesFound} comparable properties (accommodating ~${guests} guests) were found even after broadening the search to ${searchRadiusKm}km. This area may be rural or the property type may be unique, both of which can be advantageous for short-term letting due to low competition. Book a web meeting with Stayful for a detailed, personalised assessment.`;
  } else {
    qualityLevel = 'low';
    disclaimer = `Projections are based on ${bedrooms}-bedroom market median data for the area, adjusted for guest capacity and property specification. Real-time comparable listings were not available during this lookup. Book a web meeting with Stayful for accurate, personalised revenue projections based on your specific location.`;
  }

  const quality: DataQuality = {
    comparablesFound,
    comparablesTarget: TARGET_COMPARABLES,
    searchRadiusKm,
    searchBroadened,
    level: qualityLevel,
    disclaimer,
  };

  const paddedRevenue = padTo12Months(monthlyRevenue);

  return {
    data: {
      annualRevenue: Math.round(annualRevenue),
      monthlyRevenue: paddedRevenue,
      occupancyRate: Math.round(avgOccupancy * 100) / 100,
      averageDailyRate: derivedAdr,
      activeListings,
      comparables,
    },
    quality,
  };
}

// ─── Airbtics listing shape from bounds endpoint ────────────────
interface AirbticsListing {
  listingID: string;
  name: string;
  thumbnail_url: string;
  latitude: number;
  longitude: number;
  bedrooms: number;
  bathrooms: number;
  accommodates: number;
  room_type: string;
  property_type: string;
  added_on: string;
  visible_review_count: number;
  reveiw_scores_rating: number; // note: API typo
  avg_booked_daily_rate_ltm: number;
  avg_occupancy_rate_ltm: number;
  annual_revenue_ltm: number;
  active_days_count_ltm: number;
}

interface BoundsResponse {
  totalCount: number;
  listings: AirbticsListing[];
}

/**
 * Extracts and sorts comparables from a bounds search result.
 */
function extractComparables(
  result: BoundsResponse,
  guests: number,
  lat: number,
  lng: number,
): { comparables: ShortLetComparable[]; totalMatches: number } {
  // Filter by GUESTS (PMI behaviour) not bedrooms
  // Allow ±2 guest flexibility to find similar-sized properties
  const guestMatches = result.listings.filter(
    (l: AirbticsListing) =>
      Math.abs((l.accommodates ?? 0) - guests) <= 2 &&
      (l.annual_revenue_ltm ?? 0) > 0, // Filter zero-revenue listings
  );

  const withDistance = guestMatches.map((l: AirbticsListing) => ({
    ...l,
    distance: haversineKm(lat, lng, l.latitude, l.longitude),
  }));
  withDistance.sort((a, b) => a.distance - b.distance);

  const comparables = withDistance.slice(0, TARGET_COMPARABLES).map((l): ShortLetComparable => {
    const addedOn = l.added_on ? new Date(l.added_on) : null;
    const ageYears = addedOn
      ? Math.max(0, Math.round((Date.now() - addedOn.getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10)
      : 0;

    return {
      title: l.name || 'Airbnb Listing',
      url: `https://www.airbnb.co.uk/rooms/${l.listingID}`,
      bedrooms: l.bedrooms ?? 0,
      accommodates: l.accommodates ?? 0,
      averageDailyRate: Math.round(l.avg_booked_daily_rate_ltm ?? 0),
      occupancyRate: Math.round(l.avg_occupancy_rate_ltm ?? 0) / 100,
      annualRevenue: Math.round(l.annual_revenue_ltm ?? 0),
      distance: l.distance,
      rating: Math.floor(((l.reveiw_scores_rating ?? 0) / 20) * 10) / 10, // Always round DOWN
      reviewCount: l.visible_review_count ?? 0,
      listingAge: ageYears,
      daysAvailable: l.active_days_count_ltm ?? 0,
    };
  });

  return { comparables, totalMatches: guestMatches.length };
}

/**
 * Fetches nearby listings within a bounding box using the bounds endpoint.
 * Cost: $0.05/call
 */
async function fetchNearbyListings(
  lat: number,
  lng: number,
  apiKey: string,
  radiusKm: number = 1.5,
): Promise<BoundsResponse | null> {
  // At UK latitudes (~52-55°N), 1° lat ≈ 111km, 1° lng ≈ 65km
  const latOffset = radiusKm / 111;
  const lngOffset = radiusKm / 65;

  const body = {
    bounds: {
      ne_lat: lat + latOffset,
      ne_lng: lng + lngOffset,
      sw_lat: lat - latOffset,
      sw_lng: lng - lngOffset,
    },
    currency: 'GBP',
  };

  const radiusMetres = Math.round(radiusKm * 1000);
  console.log(`[DEBUG] listings/search/bounds radius: ${radiusKm}km (${radiusMetres}m)`);
  console.log('[DEBUG] listings/search/bounds body:', JSON.stringify(body));

  const response = await fetch(`${BASE_URL}/listings/search/bounds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  console.log(`[DEBUG] listings/search/bounds HTTP status: ${response.status}`);

  if (!response.ok) {
    console.error(`[DEBUG] Airbtics bounds search failed HTTP ${response.status}`);
    return null;
  }

  const data = await response.json();
  console.log('[DEBUG] Airbtics raw response:', JSON.stringify(data).slice(0, 2000));

  if (data.message === 'insufficient_credits') {
    console.log('[DEBUG] Airbtics: insufficient_credits for listings/search/bounds — returning null');
    return null;
  }

  const totalCount = data.message?.total_count ?? 0;

  // The listings field is a JSON string that needs double-parsing
  let listings: AirbticsListing[] = [];
  if (data.message?.listings) {
    try {
      const parsed = typeof data.message.listings === 'string'
        ? JSON.parse(data.message.listings)
        : data.message.listings;
      listings = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[DEBUG] Airbtics: failed to parse listings JSON:', e);
    }
  }

  console.log(`[DEBUG] Listings found: ${listings.length} (total_count: ${totalCount}, radius: ${radiusMetres}m)`);
  if (listings.length > 0) {
    console.log('[DEBUG] First listing fields:', Object.keys(listings[0]).join(','));
  }

  return { totalCount, listings };
}

interface MarketSummary {
  occupancy: number;
  average_daily_rate: number;
  revenue: number;
  active_listings_count: number;
  market_grade: string;
  regulations: string;
}

/**
 * Fetches bedroom-specific market summary. Cost: $0.25/call.
 * Returns ADR, occupancy, revenue, and active listings count for the specific bedroom count.
 */
async function fetchMarketSummary(
  marketId: number,
  bedrooms: number,
  apiKey: string,
): Promise<MarketSummary | null> {
  const url = new URL(`${BASE_URL}/markets/summary`);
  url.searchParams.set('market_id', String(marketId));
  url.searchParams.set('bedrooms', String(bedrooms));
  url.searchParams.set('currency', 'GBP');

  console.log(`[DEBUG] markets/summary URL: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });

  console.log(`[DEBUG] markets/summary HTTP status: ${response.status}`);
  if (!response.ok) return null;

  const data = await response.json();
  console.log('[DEBUG] Market summary raw:', JSON.stringify(data).slice(0, 1000));

  if (data.message === 'insufficient_credits' || typeof data.message !== 'object') {
    console.log(`[DEBUG] markets/summary rejected: ${JSON.stringify(data.message)}`);
    return null;
  }

  return data.message as MarketSummary;
}

/**
 * Finds the Airbtics market_id for a given UK postcode.
 * Extracts the city/area from the postcode prefix and searches.
 * Results are cached in memory to avoid repeat search calls.
 */
async function findMarketId(postcode: string, apiKey: string): Promise<number | null> {
  // Extract the outward code (e.g., "M1" from "M1 1AD", "SW1A" from "SW1A 1AA")
  const parts = postcode.trim().split(/\s+/);
  const outwardCode = parts[0];

  // Check cache first
  const cacheKey = outwardCode.toUpperCase();
  const cached = marketIdCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.id;
  }

  // Hardcoded market IDs for common UK cities — saves $0.01/call and avoids
  // "insufficient_credits" failures on the search endpoint
  const KNOWN_MARKETS: Record<string, number> = {
    'Manchester': 144265, 'London': 142929, 'Birmingham': 142853,
    'Bristol': 142858, 'Leeds': 142907, 'Sheffield': 142969,
    'Liverpool': 142912, 'Edinburgh': 142876, 'Glasgow': 142890,
    'Cardiff': 142863, 'Newcastle': 142928, 'Nottingham': 142941,
    'Leicester': 142910, 'Brighton': 142857, 'Oxford': 142946,
    'Cambridge': 142862, 'Bath': 142848, 'York': 143002,
    'Portsmouth': 142953, 'Southampton': 142973, 'Coventry': 142870,
    'Derby': 142873, 'Exeter': 142880, 'Plymouth': 142951,
    'Belfast': 142850, 'Aberdeen': 142838,
  };

  // Map postcode prefix to city name
  const postcodeToCity: Record<string, string> = {
    'M': 'Manchester', 'SW': 'London', 'SE': 'London', 'N': 'London', 'E': 'London',
    'W': 'London', 'EC': 'London', 'WC': 'London', 'NW': 'London',
    'B': 'Birmingham', 'BS': 'Bristol', 'LS': 'Leeds', 'S': 'Sheffield',
    'L': 'Liverpool', 'EH': 'Edinburgh', 'G': 'Glasgow', 'CF': 'Cardiff',
    'NE': 'Newcastle', 'NG': 'Nottingham', 'LE': 'Leicester', 'BN': 'Brighton',
    'OX': 'Oxford', 'CB': 'Cambridge', 'BA': 'Bath', 'YO': 'York',
    'PO': 'Portsmouth', 'SO': 'Southampton', 'CV': 'Coventry', 'DE': 'Derby',
    'EX': 'Exeter', 'PL': 'Plymouth', 'BT': 'Belfast', 'AB': 'Aberdeen',
  };

  // Find city name — sort by prefix length (longest first)
  let searchQuery = outwardCode;
  const sortedPrefixes = Object.entries(postcodeToCity).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [prefix, city] of sortedPrefixes) {
    if (outwardCode.startsWith(prefix)) {
      searchQuery = city;
      break;
    }
  }

  // Try hardcoded market ID first (free, no API call)
  if (KNOWN_MARKETS[searchQuery]) {
    const marketId = KNOWN_MARKETS[searchQuery];
    marketIdCache.set(cacheKey, { id: marketId, expiresAt: Date.now() + CACHE_TTL_MS });
    return marketId;
  }

  // Fall back to API search for unknown cities
  const url = new URL(`${BASE_URL}/markets/search`);
  url.searchParams.set('query', searchQuery);
  url.searchParams.set('country_code', 'GB');

  const response = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });

  if (!response.ok) {
    marketIdCache.set(cacheKey, { id: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const data = await response.json();
  const markets = data.message;

  if (!Array.isArray(markets) || markets.length === 0 || data.message === 'insufficient_credits') {
    marketIdCache.set(cacheKey, { id: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  }

  // Prefer verified markets
  const verified = markets.find((m: Record<string, unknown>) => m.verified === true);
  const marketId = (verified?.id ?? markets[0].id) as number;

  // Cache the result
  marketIdCache.set(cacheKey, { id: marketId, expiresAt: Date.now() + CACHE_TTL_MS });

  return marketId;
}

/**
 * Fetches a specific metric from the Airbtics markets/metrics endpoint.
 */
async function fetchMetric(
  metric: string,
  marketId: number,
  bedrooms: number,
  apiKey: string,
  currency?: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${BASE_URL}/markets/metrics/${metric}`);
  url.searchParams.set('market_id', String(marketId));
  url.searchParams.set('bedrooms', String(bedrooms));
  if (currency) url.searchParams.set('currency', currency);

  console.log(`[DEBUG] markets/metrics/${metric} URL: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });

  console.log(`[DEBUG] markets/metrics/${metric} HTTP status: ${response.status}`);

  if (!response.ok) return [];

  const data = await response.json();
  console.log(`[DEBUG] Market monthly (${metric}) raw:`, JSON.stringify(data).slice(0, 1000));

  if (data.message === 'insufficient_credits') {
    console.log(`[DEBUG] markets/metrics/${metric}: insufficient_credits`);
    return [];
  }

  return Array.isArray(data.message) ? data.message : [];
}

/**
 * Extracts the last 12 months of a specific percentile value from metric data.
 */
function extractLast12Months(
  data: Record<string, unknown>[],
  field: string,
): number[] {
  const last12 = data.slice(-12);
  return last12.map((item) => Number(item[field] ?? 0));
}

/**
 * Pads or trims monthly data to exactly 12 entries.
 */
function padTo12Months(data: number[]): ShortLetData['monthlyRevenue'] {
  if (data.length >= 12) {
    return data.slice(-12) as ShortLetData['monthlyRevenue'];
  }
  const padded = [...data];
  while (padded.length < 12) {
    padded.unshift(padded[0] ?? 0);
  }
  return padded as ShortLetData['monthlyRevenue'];
}

/**
 * Generates realistic short-let estimates based on UK market averages.
 * Used when Airbtics API is unavailable or has insufficient credits.
 */
function generateMarketEstimate(bedrooms: number): ShortLetData {
  const adrRanges: Record<number, [number, number]> = {
    1: [85, 100],
    2: [110, 140],
    3: [150, 200],
  };
  const defaultRange: [number, number] = [200, 280];
  const [adrLow, adrHigh] = adrRanges[bedrooms] ?? defaultRange;
  const adr = Math.round((adrLow + adrHigh) / 2);

  const occupancy = bedrooms <= 1 ? 0.72 : bedrooms <= 2 ? 0.70 : bedrooms <= 3 ? 0.67 : 0.65;
  const annualRevenue = Math.round(adr * 365 * occupancy);

  const seasonalMultipliers = [
    0.82, 0.85, 0.95, 1.00, 1.08, 1.18, 1.25, 1.22, 1.10, 0.98, 0.88, 0.80,
  ];
  const baseMonthly = annualRevenue / 12;
  const monthlyRevenue = seasonalMultipliers.map((m) =>
    Math.round(baseMonthly * m),
  ) as ShortLetData['monthlyRevenue'];

  return {
    annualRevenue,
    monthlyRevenue,
    occupancyRate: occupancy,
    averageDailyRate: adr,
    activeListings: 0,
    comparables: [],
  };
}
