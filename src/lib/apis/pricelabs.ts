/**
 * PriceLabs Revenue Estimator API integration.
 *
 * Endpoint: GET https://api.pricelabs.co/v1/revenue/estimator
 * Auth:     X-API-Key header
 * Docs:     https://app.swaggerhub.com/apis-docs/PriceLabs/Revenue_Estimator/v1
 *
 * Returns a direct annual revenue estimate for a property based on
 * PriceLabs' own scraped Airbnb dataset. When successful this becomes the
 * PRIMARY headline source — the analyse route overrides shortLet.* with
 * these values. On any failure (missing key, HTTP error, no data for the
 * bedroom category) we return null and the route falls back to the
 * existing V4-on-Airbtics pipeline.
 *
 * Trial subscription tier ships with a 20-call quota. After that the API
 * returns 429 — we handle it gracefully like any other failure.
 */

const RE_ENDPOINT = 'https://api.pricelabs.co/v1/revenue/estimator';
// PriceLabs docs say 6-8s for 350 listings; allow 30s for safety
const REQUEST_TIMEOUT_MS = 30_000;

export interface PriceLabsRevenueEstimate {
  annualRevenue: number;
  rangeLow: number;          // 25th percentile sum (lower bound)
  rangeHigh: number;         // 75th percentile sum (upper bound)
  adr: number;               // 50th percentile ADR average
  occupancy: number;         // 0-1 fraction
  monthlyRevenue: number[];  // 12 entries [Jan..Dec], £ rounded
  listingsConsidered: number;
  bedroomCategory: number;
  source: 'pricelabs_revenue_estimator_v2';
}

interface BedroomKPIs {
  Revenue50PercentileSum?: number;
  Revenue25PercentileSum?: number;
  Revenue75PercentileSum?: number;
  ADR50PercentileAvg?: number;
  AvgAdjustedOccupancy?: number;
  NoOfListings?: number;
  MonthlyBreakup?: {
    Revenue50Percentile?: Record<string, number>;
  };
}

interface PriceLabsV2Response {
  KPIsByBedroomCategory?: Record<string, BedroomKPIs>;
  bedrooms_considered?: string[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export async function fetchPriceLabsRevenueEstimate(params: {
  address: string;
  bedrooms: number;
  lat?: number;
  lng?: number;
  currency?: string;
}): Promise<PriceLabsRevenueEstimate | null> {
  const apiKey = process.env.PRICELABS_API_KEY;
  if (!apiKey) {
    console.log('[PriceLabs RE] PRICELABS_API_KEY not set — skipping');
    return null;
  }
  if (!params.address || params.address.trim().length === 0) {
    console.log('[PriceLabs RE] address required, skipping');
    return null;
  }

  // PriceLabs uses 1-based bedroom categories. Treat studios as 1-bed for
  // the lookup (separately our generateMarketEstimate handles studios).
  const bedroomCat = Math.max(1, Math.round(params.bedrooms));

  const url = new URL(RE_ENDPOINT);
  url.searchParams.set('version', '2');
  url.searchParams.set('address', params.address);
  if (Number.isFinite(params.lat)) url.searchParams.set('latitude', String(params.lat));
  if (Number.isFinite(params.lng)) url.searchParams.set('longitude', String(params.lng));
  url.searchParams.set('currency', params.currency || 'GBP');
  // NB: param name has a literal space — URL encoder handles it.
  url.searchParams.set('Bedroom category', String(bedroomCat));
  url.searchParams.set('Monthly', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const safeUrl = url.toString().replace(apiKey, '<redacted>');
    console.log(`[PriceLabs RE] GET ${safeUrl}`);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);

    console.log(`[PriceLabs RE] HTTP ${response.status}`);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[PriceLabs RE] non-200 (${response.status}): ${body.slice(0, 400)}`);
      return null;
    }

    const data = await response.json().catch((e) => {
      console.error('[PriceLabs RE] JSON parse error:', e);
      return null;
    }) as PriceLabsV2Response | null;
    if (!data) return null;

    const categoryKey = String(bedroomCat);
    const kpis = data.KPIsByBedroomCategory?.[categoryKey];
    if (!kpis) {
      const available = Object.keys(data.KPIsByBedroomCategory || {});
      console.error(`[PriceLabs RE] no KPIs for bedroom category "${categoryKey}". Available: [${available.join(',')}]`);
      return null;
    }

    const annualRevenue = Number(kpis.Revenue50PercentileSum);
    if (!Number.isFinite(annualRevenue) || annualRevenue <= 0) {
      console.error(`[PriceLabs RE] Revenue50PercentileSum invalid for category ${categoryKey}: ${kpis.Revenue50PercentileSum}`);
      return null;
    }

    const rangeLow = Number(kpis.Revenue25PercentileSum) || Math.round(annualRevenue * 0.7);
    const rangeHigh = Number(kpis.Revenue75PercentileSum) || Math.round(annualRevenue * 1.3);
    const adr = Number(kpis.ADR50PercentileAvg) || 0;
    // AvgAdjustedOccupancy is 0-100 in V2 response
    const occRaw = Number(kpis.AvgAdjustedOccupancy) || 0;
    const occupancy = occRaw > 1 ? occRaw / 100 : occRaw;
    const listingsConsidered = Number(kpis.NoOfListings) || 0;

    const monthlyMap = kpis.MonthlyBreakup?.Revenue50Percentile || {};
    const monthlyRevenue = MONTH_NAMES.map((m) => {
      const v = Number(monthlyMap[m]);
      return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    });

    const result: PriceLabsRevenueEstimate = {
      annualRevenue: Math.round(annualRevenue),
      rangeLow: Math.round(rangeLow),
      rangeHigh: Math.round(rangeHigh),
      adr: Math.round(adr),
      occupancy,
      monthlyRevenue,
      listingsConsidered,
      bedroomCategory: bedroomCat,
      source: 'pricelabs_revenue_estimator_v2',
    };

    console.log(
      `[PriceLabs RE] success: annual=£${result.annualRevenue} range=[£${result.rangeLow}, £${result.rangeHigh}] adr=£${result.adr} occ=${(result.occupancy*100).toFixed(0)}% listings=${result.listingsConsidered}`,
    );
    return result;
  } catch (err) {
    clearTimeout(timer);
    console.error('[PriceLabs RE] fetch failed:', err);
    return null;
  }
}

/**
 * Build a CrossValidation result given both signals.
 *
 * priceLabs is the primary if non-null. airbticsRevenue is always provided
 * (V4 always runs). divergencePct measures agreement between the two.
 */
export type CrossValidationConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface CrossValidationOutcome {
  source: 'pricelabs_revenue_estimator_v2' | 'airbtics_v4_aggregation';
  confidence: CrossValidationConfidence;
  airbticsRevenue: number;
  priceLabsRevenue: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  priceLabsListings: number | null;
  divergencePct: number | null;
  note: string;
}

export function buildCrossValidation(
  airbticsRevenue: number,
  priceLabs: PriceLabsRevenueEstimate | null,
): CrossValidationOutcome {
  if (!priceLabs || priceLabs.annualRevenue <= 0) {
    return {
      source: 'airbtics_v4_aggregation',
      confidence: 'unverified',
      airbticsRevenue,
      priceLabsRevenue: null,
      rangeLow: null,
      rangeHigh: null,
      priceLabsListings: null,
      divergencePct: null,
      note: 'PriceLabs Revenue Estimator unavailable — using Airbtics-derived estimate.',
    };
  }

  const divergencePct = airbticsRevenue > 0
    ? ((priceLabs.annualRevenue - airbticsRevenue) / airbticsRevenue) * 100
    : 0;
  const abs = Math.abs(divergencePct);
  let confidence: CrossValidationConfidence;
  let note: string;
  if (abs <= 15) {
    confidence = 'high';
    note = `PriceLabs and Airbtics agree within ${abs.toFixed(1)}%. Using PriceLabs estimate.`;
  } else if (abs <= 30) {
    confidence = 'medium';
    note = `PriceLabs and Airbtics differ by ${abs.toFixed(1)}%. Using PriceLabs (more granular dataset).`;
  } else {
    confidence = 'low';
    note = `PriceLabs and Airbtics differ by ${abs.toFixed(1)}% — wide range. Using PriceLabs but treat as low-confidence.`;
  }

  return {
    source: 'pricelabs_revenue_estimator_v2',
    confidence,
    airbticsRevenue,
    priceLabsRevenue: priceLabs.annualRevenue,
    rangeLow: priceLabs.rangeLow,
    rangeHigh: priceLabs.rangeHigh,
    priceLabsListings: priceLabs.listingsConsidered,
    divergencePct,
    note,
  };
}
