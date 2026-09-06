/**
 * Google Geocoding API — converts a UK postcode to lat/lng coordinates.
 */

export async function geocodePostcode(
  postcode: string,
): Promise<{ lat: number; lng: number }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in environment variables.');
  }

  const encodedPostcode = encodeURIComponent(postcode.trim() + ', UK');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedPostcode}&key=${apiKey}`;

  const response = await fetch(url);

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

  return { lat, lng };
}

/**
 * Reverse geocode a point to the nearest UK postcode. Used for Airbnb
 * listings, which only expose an approximate pin. Returns null (never
 * throws) when the key is missing or Google finds no postcode.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<{ postcode: string; outcode: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=postal_code&region=gb&key=${apiKey}`;
    const res = await fetch(url);
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
