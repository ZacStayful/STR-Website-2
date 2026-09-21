/**
 * Google Geocoding API — converts a UK postcode to lat/lng coordinates.
 * Every call is metered (src/lib/credit/meter.ts) against whoever is running
 * the current action.
 */

import { meter } from '../credit/meter.ts';

export interface GeocodeResult {
  lat: number;
  lng: number;
  /**
   * The town this postcode sits in, when Google reports one. The PDF's running
   * header reads "<address> · <town>"; older analyses have no locality stored
   * and fall back to parsing the address string.
   */
  locality?: string;
}

export async function geocodePostcode(postcode: string): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in environment variables.');
  }

  const encodedPostcode = encodeURIComponent(postcode.trim() + ', UK');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedPostcode}&key=${apiKey}`;

  const response = await meter({ provider: 'google', unit: 'geocode', key: postcode.trim().toUpperCase(), failed: (r) => !r.ok }, () => fetch(url));

  if (!response.ok) {
    throw new Error(
      `Geocoding API returned HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = await response.json();

  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(
      `Geocoding failed for postcode "${postcode}". API status: ${data.status}. ${data.error_message ?? ''}`.trim(),
    );
  }

  const { lat, lng } = data.results[0].geometry.location;

  // `postal_town` is the name people actually use for where they live;
  // `locality` and the county are progressively worse stand-ins.
  const components = (data.results[0].address_components ?? []) as Array<{
    long_name: string;
    types: string[];
  }>;
  const pick = (type: string) => components.find((c) => c.types.includes(type))?.long_name;
  const locality =
    pick('postal_town') ?? pick('locality') ?? pick('administrative_area_level_2');

  return { lat, lng, ...(locality ? { locality } : {}) };
}

const REVERSE_GEOCODE_TIMEOUT_MS = 6_000;

/**
 * Reverse geocode a point to the nearest UK postcode. Used for Airbnb
 * listings, which only expose an approximate pin. Returns null (never
 * throws) when the key is missing, Google finds no postcode, or the
 * lookup takes longer than a few seconds.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<{ postcode: string; outcode: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=postal_code&region=gb&key=${apiKey}`;
    const res = await meter({ provider: 'google', unit: 'reverse_geocode', key: `${lat.toFixed(4)},${lng.toFixed(4)}`, failed: (r) => !r.ok }, () => fetch(url, { signal: AbortSignal.timeout(REVERSE_GEOCODE_TIMEOUT_MS) }));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results)) return null;
    for (const r of data.results) {
      const comp = (r.address_components as { long_name: string; types: string[] }[] | undefined)?.find((c) => c.types.includes('postal_code'));
      const m = comp?.long_name.toUpperCase().match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/);
      if (m) return { postcode: `${m[1]} ${m[2]}`, outcode: m[1] };
    }
    return null;
  } catch {
    return null;
  }
}
