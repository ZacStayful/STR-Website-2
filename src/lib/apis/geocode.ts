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
