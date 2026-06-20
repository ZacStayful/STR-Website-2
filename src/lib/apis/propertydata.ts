/**
 * PropertyData API integration.
 *
 * Endpoints used:
 *   /floor-areas     — square footage + build year
 *   /valuation-rent  — long-term rental estimate (GBP/week → monthly)
 *   /valuation-sale  — estimated sale value
 *
 * API key: PROPERTYDATA_API_KEY environment variable
 * Docs / key signup: https://propertydata.co.uk/api
 *
 * Retry strategy: if the first attempt fails (API requires ALL params and
 * rejects invalid combos), retry with progressively simpler defaults.
 *
 * All functions return a fallback / null on any failure — they must NEVER
 * throw or block the main analysis pipeline.
 */

import type { LongLetData, PropertyDataValuation } from '../types';

// ─── Bedroom-scaled defaults ────────────────────────────────────
// More realistic than a single static default for all property sizes.
const AREA_BY_BEDROOMS: Record<number, number> = {
  1: 500, 2: 700, 3: 900, 4: 1100, 5: 1350,
};

// UK national median monthly rents (2024, ONS/Zoopla blend).
// Used as last-resort fallback when PropertyData API has no data for the area.
const UK_FALLBACK_MONTHLY_RENT: Record<number, number> = {
  0: 950, 1: 1100, 2: 1400, 3: 1650, 4: 2050, 5: 2500,
};

// ─── Floor Area + Build Year from /floor-areas ─────────────────
export interface FloorAreaResult {
  squareFeet: number;
  constructionDate: string; // 'pre_1914' | '1914_2000' | '2000_onwards'
}

/**
 * Calls the PropertyData /floor-areas endpoint to get actual square footage
 * and build year for the property. Falls back to bedroom-based defaults.
 */
export async function getFloorArea(
  postcode: string,
  address: string,
  bedrooms: number,
): Promise<FloorAreaResult> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  const clampedBedrooms = Math.max(1, Math.min(bedrooms, 5));
  const fallbackArea = AREA_BY_BEDROOMS[clampedBedrooms] ?? 700;
  const fallbackResult: FloorAreaResult = {
    squareFeet: fallbackArea,
    constructionDate: '1914_2000',
  };

  if (!apiKey) {
    console.log('PROPERTYDATA_API_KEY not set, using bedroom fallback for floor area');
    return fallbackResult;
  }

  try {
    const url = new URL('https://api.propertydata.co.uk/floor-areas');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('postcode', postcode);

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.log(`PropertyData /floor-areas: HTTP ${response.status}`);
      return fallbackResult;
    }

    const data = await response.json();
    if (data.status === 'error' || !data.data || !Array.isArray(data.data)) {
      console.log('PropertyData /floor-areas: no data array returned');
      return fallbackResult;
    }

    // Try to match the address in the results
    const normAddr = address.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestMatch: { square_feet?: number; build_year?: number } | null = null;

    for (const entry of data.data) {
      const entryAddr = (entry.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (entryAddr.includes(normAddr) || normAddr.includes(entryAddr)) {
        bestMatch = entry;
        break;
      }
    }

    // If no exact match, try partial match on house number
    if (!bestMatch) {
      const houseNumber = address.match(/^\d+/)?.[0];
      if (houseNumber) {
        for (const entry of data.data) {
          const entryAddr = (entry.address || '');
          if (entryAddr.startsWith(houseNumber + ' ') || entryAddr.startsWith(houseNumber + ',')) {
            bestMatch = entry;
            break;
          }
        }
      }
    }

    if (!bestMatch) {
      console.log('PropertyData /floor-areas: no address match found, using bedroom fallback');
      return fallbackResult;
    }

    const sqFt = bestMatch.square_feet ? Number(bestMatch.square_feet) : fallbackArea;
    let constructionDate = '1914_2000';

    if (bestMatch.build_year) {
      const year = Number(bestMatch.build_year);
      if (year < 1914) {
        constructionDate = 'pre_1914';
      } else if (year >= 2000) {
        constructionDate = '2000_onwards';
      }
      // else stays '1914_2000'
    }

    console.log(`PropertyData /floor-areas: matched ${sqFt} sq ft, build ${constructionDate}`);
    return { squareFeet: sqFt, constructionDate };
  } catch (err) {
    console.log('PropertyData /floor-areas: fetch error:', err);
    return fallbackResult;
  }
}

const BATHROOMS_BY_BEDROOMS: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 2, 5: 3,
};

export async function getLongLetData(
  postcode: string,
  bedrooms: number,
  options?: {
    propertyType?: string;
    constructionDate?: string;
    internalArea?: number;
    bathrooms?: number;
    finishQuality?: string;
    outdoorSpace?: string;
    offStreetParking?: number;
  },
): Promise<LongLetData> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  const clampedBedrooms = Math.max(1, Math.min(bedrooms, 5));

  if (!apiKey) {
    console.log('[PropertyData] PROPERTYDATA_API_KEY not set — using national median fallback for long-let');
    const fallbackRent = UK_FALLBACK_MONTHLY_RENT[clampedBedrooms] ?? 1400;
    return {
      monthlyRent: fallbackRent,
      estimateHigh: Math.round(fallbackRent * 1.15),
      estimateLow: Math.round(fallbackRent * 0.85),
      comparables: [],
    };
  }

  // Attempt 1: Full params with bedroom-scaled defaults + high finish
  const attempt1Params = {
    postcode,
    property_type: options?.propertyType ?? 'flat',
    construction_date: options?.constructionDate ?? '2000_onwards',
    internal_area: String(Math.max(options?.internalArea ?? AREA_BY_BEDROOMS[clampedBedrooms] ?? 650, 300)),
    bedrooms: String(bedrooms),
    bathrooms: String(options?.bathrooms ?? BATHROOMS_BY_BEDROOMS[clampedBedrooms] ?? 1),
    finish_quality: options?.finishQuality ?? 'high',
    outdoor_space: options?.outdoorSpace ?? 'none',
    off_street_parking: String(options?.offStreetParking ?? 0),
  };

  const result1 = await tryPropertyDataCall(apiKey, attempt1Params);
  if (result1) {
    console.log('PropertyData: succeeded on attempt 1 (full params, high finish)');
    return result1;
  }

  // Attempt 2: Keep user's property type but simplify other params
  const userPropertyType = options?.propertyType ?? 'flat';
  const attempt2Params = {
    postcode,
    property_type: userPropertyType,
    construction_date: '1914_2000',
    internal_area: String(AREA_BY_BEDROOMS[clampedBedrooms] ?? 650),
    bedrooms: String(bedrooms),
    bathrooms: String(BATHROOMS_BY_BEDROOMS[clampedBedrooms] ?? 1),
    finish_quality: 'average',
    outdoor_space: 'none',
    off_street_parking: '0',
  };

  const result2 = await tryPropertyDataCall(apiKey, attempt2Params);
  if (result2) {
    console.log(`PropertyData: succeeded on attempt 2 (${userPropertyType}, average finish)`);
    return result2;
  }

  // Attempt 3: Try all common property types until one works
  const propertyTypes = ['terraced_house', 'semi-detached_house', 'detached_house', 'flat'];
  for (const pType of propertyTypes) {
    const attempt3Params = {
      postcode,
      property_type: pType,
      construction_date: '1914_2000',
      internal_area: String(AREA_BY_BEDROOMS[clampedBedrooms] ?? 650),
      bedrooms: String(bedrooms),
      bathrooms: '1',
      finish_quality: 'average',
      outdoor_space: 'none',
      off_street_parking: '0',
    };

    const result3 = await tryPropertyDataCall(apiKey, attempt3Params);
    if (result3) {
      console.log(`PropertyData: succeeded on attempt 3 (${pType})`);
      return result3;
    }
  }

  // All attempts failed — use national median fallback so long-let is always populated.
  const fallbackRent = UK_FALLBACK_MONTHLY_RENT[clampedBedrooms] ?? 1400;
  console.log(`[PropertyData] all attempts failed — using national median fallback £${fallbackRent}/mo`);
  return {
    monthlyRent: fallbackRent,
    estimateHigh: Math.round(fallbackRent * 1.15),
    estimateLow: Math.round(fallbackRent * 0.85),
    comparables: [],
  };
}

/**
 * Makes a single PropertyData valuation-rent call. Returns null on failure.
 */
async function tryPropertyDataCall(
  apiKey: string,
  params: Record<string, string>,
): Promise<LongLetData | null> {
  try {
    // PropertyData requires the postcode WITH spaces — do NOT strip them
    const url = new URL('https://api.propertydata.co.uk/valuation-rent');
    url.searchParams.set('key', apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.log(`PropertyData: HTTP ${response.status} for params:`, params);
      return null;
    }

    const data = await response.json();

    if (data.status === 'error') {
      console.log(`PropertyData: API error "${data.message}" for params:`, params);
      return null;
    }

    // Response: { "status": "success", "result": { "estimate": 842, "unit": "gbp_per_week" } }
    const weeklyRent = Number(data.result?.estimate ?? 0);

    if (weeklyRent <= 0) {
      console.log('PropertyData: got zero/negative weekly rent');
      return null;
    }

    // Convert weekly to monthly: weekly * 52 / 12
    const monthlyRent = Math.round(weeklyRent * 52 / 12);

    // No high/low in the API response — derive from point estimate
    const estimateHigh = Math.round(monthlyRent * 1.15);
    const estimateLow = Math.round(monthlyRent * 0.85);

    return {
      monthlyRent,
      estimateHigh,
      estimateLow,
      comparables: [],
    };
  } catch (err) {
    console.log('PropertyData: fetch error:', err);
    return null;
  }
}

// ─── Sale Valuation ──────────────────────────────────────────────

/**
 * Fetches an estimated sale value from the PropertyData /valuation-sale
 * endpoint. Returns null on any failure — must never block the analysis.
 *
 * Retries with simplified params if the first attempt fails.
 */
export async function fetchPropertyValuation(
  postcode: string,
  bedrooms: number,
  propertyType: string,
): Promise<PropertyDataValuation | null> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  if (!apiKey) {
    console.log('[PropertyData] PROPERTYDATA_API_KEY not set — skipping sale valuation');
    return null;
  }

  // Normalise property type to PropertyData expected values
  const PT_MAP: Record<string, string> = {
    flat: 'flat',
    terraced_house: 'terraced_house',
    'semi-detached_house': 'semi-detached_house',
    detached_house: 'detached_house',
    Flat: 'flat',
    Terraced: 'terraced_house',
    'Semi-detached': 'semi-detached_house',
    'Terraced House': 'terraced_house',
    'Semi-Detached House': 'semi-detached_house',
    'Detached House': 'detached_house',
    Detached: 'detached_house',
  };
  const mappedType = PT_MAP[propertyType] ?? 'flat';
  const clampedBedrooms = Math.max(1, Math.min(bedrooms, 5));

  async function attemptSale(params: Record<string, string>): Promise<PropertyDataValuation | null> {
    try {
      const url = new URL('https://api.propertydata.co.uk/valuation-sale');
      url.searchParams.set('key', apiKey!);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

      const safeUrl = url.toString().replace(apiKey!, '<redacted>');
      console.log(`[PropertyData] GET ${safeUrl}`);

      const response = await fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.log(`[PropertyData] /valuation-sale HTTP ${response.status}: ${body.slice(0, 300)}`);
        return null;
      }

      const data = await response.json().catch(() => null);
      if (!data) {
        console.log('[PropertyData] /valuation-sale JSON parse failed');
        return null;
      }
      if (data.status === 'error') {
        console.log(`[PropertyData] /valuation-sale API error: ${data.message ?? 'unknown'}`);
        return null;
      }

      // PropertyData may return the estimate under various keys depending on
      // API version/endpoint. Check all known fields.
      const result = data.result ?? data;
      const estimate = Number(
        result?.estimate
        ?? result?.estimate_value
        ?? result?.valuation
        ?? result?.price
        ?? result?.value
        ?? 0,
      );

      if (!Number.isFinite(estimate) || estimate <= 0) {
        console.log(`[PropertyData] /valuation-sale: no usable estimate. Raw result keys: [${Object.keys(result || {}).join(',')}]`);
        return null;
      }

      const rangeLow = Number(
        result?.range_low ?? result?.estimate_low ?? result?.low ?? 0,
      ) || Math.round(estimate * 0.85);
      const rangeHigh = Number(
        result?.range_high ?? result?.estimate_high ?? result?.high ?? 0,
      ) || Math.round(estimate * 1.15);

      console.log(`[PropertyData] /valuation-sale success: £${estimate} (£${rangeLow}–£${rangeHigh})`);
      return {
        estimatedValue: Math.round(estimate),
        valuationRangeLow: Math.round(rangeLow),
        valuationRangeHigh: Math.round(rangeHigh),
        source: 'propertydata',
      };
    } catch (err) {
      console.log('[PropertyData] /valuation-sale fetch error:', err);
      return null;
    }
  }

  // Attempt 1: full params
  const r1 = await attemptSale({
    postcode,
    property_type: mappedType,
    bedrooms: String(clampedBedrooms),
    bathrooms: String(BATHROOMS_BY_BEDROOMS[clampedBedrooms] ?? 1),
    finish_quality: 'average',
    construction_date: '1914_2000',
    internal_area: String(AREA_BY_BEDROOMS[clampedBedrooms] ?? 700),
    outdoor_space: 'none',
    off_street_parking: '0',
  });
  if (r1) return r1;

  // Attempt 2: minimal params
  const r2 = await attemptSale({ postcode, property_type: mappedType, bedrooms: String(clampedBedrooms) });
  if (r2) return r2;

  // Attempt 3: try alternate property types
  for (const pType of ['flat', 'terraced_house', 'semi-detached_house', 'detached_house']) {
    if (pType === mappedType) continue;
    const r3 = await attemptSale({ postcode, property_type: pType, bedrooms: String(clampedBedrooms) });
    if (r3) return r3;
  }

  console.log('[PropertyData] /valuation-sale: all attempts failed, returning null');
  return null;
}
