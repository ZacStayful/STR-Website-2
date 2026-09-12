import 'server-only';

/**
 * Property Market Intel client (https://api.propertymarketintel.com/v1).
 * Bearer key `PMI_API_KEY`; every call deducts credits from the monthly
 * allowance (str-estimate 50, str/market 3, listings 1, account free), so
 * nothing here is called outside the broker's budgeted rungs.
 */

import { meter } from '../../credit/meter';

const BASE = (process.env.PMI_API_BASE ?? 'https://api.propertymarketintel.com/v1').replace(/\/$/, '');
const TIMEOUT_MS = 20_000;

export class PmiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const PMI_UNITS: Record<string, string> = { '/valuations/str-estimate': 'str_estimate', '/str/market': 'str_market', '/listings': 'listings', '/account': 'account' };

async function pmi<T>(path: string, init: { method?: 'GET' | 'POST'; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T | null> {
  const key = process.env.PMI_API_KEY;
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await meter(
      // Every PMI path bills credits: str-estimate 50, str/market 3, listings 1, account 0.
      { provider: 'pmi', unit: PMI_UNITS[path] ?? 'other', key: url.pathname + url.search, failed: (r) => !r.ok && r.status !== 404 },
      () =>
        fetch(url, {
          method: init.method ?? 'GET',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
          body: init.body ? JSON.stringify(init.body) : undefined,
          cache: 'no-store',
          signal: controller.signal,
        }),
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PmiError(`PMI ${path} → HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface PmiStrEstimate {
  annual_revenue: number;
  average_daily_rate: number;
  occupancy_rate: number; // 0–1
  bedrooms: number;
  bathrooms?: number;
  accommodates?: number;
  confidence: 'high' | 'medium' | 'low';
  revenue_range?: { lower: number | string; upper: number | string };
  monthly_breakdown?: { month: string; revenue: number; adr: number | string; occupancy: number | string }[];
  comparables?: PmiComparable[];
  location?: { lat: number; lng: number };
  location_label?: string;
  market?: { comp_adr_avg?: number; comp_occ_avg?: number };
}

export interface PmiComparable {
  property_id: string;
  title?: string;
  bedrooms?: number;
  bathrooms?: number | string;
  accommodates?: number | string;
  revenue?: number;
  adr?: number | string;
  occupancy?: number | string;
  distance_m?: number;
  rating?: number | string;
  listing_url?: string;
  similarity?: number | string;
}

export interface PmiStrMarket {
  location?: string;
  as_of?: string;
  summary?: { adr?: number | string; occupancy_pct?: number; revpar?: number | string; revenue_pcm?: number; revenue_annual?: number; active_listings?: number | string };
  supply?: { active_listings?: number | string; yoy_growth_pct?: number; new_listings_30d?: number | string; blocked_listings?: number | string };
  by_bedrooms?: { bedrooms: number; listings: number | string; adr: number | string; occupancy_pct: number; revenue_pcm: number }[];
  demand?: { booked_nights_30d?: number | string; available_nights_30d?: number | string; lead_time_avg_days?: number; length_of_stay_avg?: number };
  grade?: { letter?: string; score_0_100?: number; strongest?: string[]; weakest?: string[] };
  historical?: { month: string; adr: number | string; occupancy_pct: number; revenue_pcm: number; revpar?: number | string; yoy_revenue_change?: number }[];
  ratings?: { overall_avg?: number; count_with_rating?: number };
}

export interface PmiListing {
  uprn?: string;
  address?: string;
  postcode?: string;
  price?: number;
  bedrooms?: number;
  property_type?: string;
  tenure?: string;
  tags?: string[];
  listed_date?: string;
  distance_m?: number;
  url?: string;
}

export interface PmiListingsResponse {
  listings: PmiListing[];
  total_count?: number;
  total_pages?: number;
  page?: number;
  location?: string;
}

export interface PmiAccount {
  plan?: string;
  credits_monthly?: number;
  credits_remaining?: number;
  credits_used_this_month?: number;
  rate_limit_per_10s?: number;
}

/** 50 credits. Property-level 12-month projection with optional comps. */
export function pmiStrEstimate(input: { postcode: string; bedrooms: number; bathrooms?: number; propertyType?: 'house' | 'apartment'; includeComparables?: boolean }): Promise<PmiStrEstimate | null> {
  return pmi<PmiStrEstimate>('/valuations/str-estimate', {
    method: 'POST',
    body: {
      postcode: input.postcode,
      bedrooms: input.bedrooms,
      ...(input.bathrooms ? { bathrooms: input.bathrooms } : {}),
      ...(input.propertyType ? { property_type: input.propertyType } : {}),
      finish_quality: 'average',
      include_comparables: input.includeComparables ?? false,
    },
  });
}

/** 3 credits. Area STR intelligence by postcode, outcode or point. */
export function pmiStrMarket(where: { postcode?: string; outcode?: string; lat?: number; lng?: number; radiusM?: number }, opts: { bedrooms?: number; include?: string[] } = {}): Promise<PmiStrMarket | null> {
  return pmi<PmiStrMarket>('/str/market', {
    query: {
      postcode: where.postcode,
      outcode: where.outcode,
      lat: where.lat,
      lng: where.lng,
      radius_m: where.radiusM,
      bedrooms: opts.bedrooms,
      include: opts.include?.join(','),
    },
  });
}

/** 1 credit. Live for-sale / to-rent listings near a location. */
export function pmiListings(where: { postcode?: string; outcode?: string; lat?: number; lng?: number; radiusM?: number }, opts: { type?: 'sale' | 'rent'; minPrice?: number; maxPrice?: number; minBedrooms?: number; maxBedrooms?: number; sort?: string; page?: number; perPage?: number } = {}): Promise<PmiListingsResponse | null> {
  return pmi<PmiListingsResponse>('/listings', {
    query: {
      postcode: where.postcode,
      outcode: where.outcode,
      lat: where.lat,
      lng: where.lng,
      radius_m: where.radiusM,
      type: opts.type ?? 'sale',
      min_price: opts.minPrice,
      max_price: opts.maxPrice,
      min_bedrooms: opts.minBedrooms,
      max_bedrooms: opts.maxBedrooms,
      sort: opts.sort ?? 'date_desc',
      page: opts.page ?? 1,
      per_page: Math.min(50, opts.perPage ?? 50),
    },
  });
}

/** Free. Plan and remaining credits — used by the admin panel and the spike. */
export function pmiAccount(): Promise<PmiAccount | null> {
  return pmi<PmiAccount>('/account');
}

export function pmiConfigured(): boolean {
  return Boolean(process.env.PMI_API_KEY);
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[£,%\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
