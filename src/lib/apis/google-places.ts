/**
 * Google Places API (New) — fetches nearby amenities by category.
 */

import type { DemandDrivers, NearbyAmenity } from '../types';

const SEARCH_RADIUS = 5000; // metres
const AIRPORT_SEARCH_RADIUS = 50_000; // metres — real airports are further away
const MAX_RESULTS_TRANSPORT = 5;
const MAX_RESULTS_INSTITUTIONS = 10; // fetch more, then filter to quality results

const FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.types',
  'places.rating',
  'places.location',
].join(',');

interface PlaceResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  types?: string[];
  rating?: number;
  location?: { latitude?: number; longitude?: number };
}

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

async function searchNearbyByType(
  lat: number,
  lng: number,
  includedType: string,
  apiKey: string,
): Promise<NearbyAmenity[]> {
  const radius = includedType === 'airport' ? AIRPORT_SEARCH_RADIUS
    : includedType === 'hospital' ? 15_000  // 15km — major hospitals may be further
    : SEARCH_RADIUS;

  // Fetch more for hospitals/universities so we can filter to quality results
  const isInstitution = includedType === 'hospital' || includedType === 'university';
  const maxResults = isInstitution ? MAX_RESULTS_INSTITUTIONS : MAX_RESULTS_TRANSPORT;

  const body = {
    includedTypes: [includedType],
    maxResultCount: maxResults,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };

  const response = await fetch(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    console.error(
      `Google Places search for "${includedType}" returned HTTP ${response.status}`,
    );
    return [];
  }

  const data = await response.json();
  const places: PlaceResult[] = data.places ?? [];

  const amenities = places.map((place) => {
    const placeLat = place.location?.latitude ?? lat;
    const placeLng = place.location?.longitude ?? lng;

    return {
      name: place.displayName?.text ?? 'Unknown',
      type: includedType,
      address: place.formattedAddress ?? '',
      distance: haversineKm(lat, lng, placeLat, placeLng),
      rating: place.rating ?? null,
    };
  });

  // Filter out hospital helipads from airport results
  if (includedType === 'airport') {
    return amenities.filter(
      (a) => !/helipad|heliport/i.test(a.name),
    );
  }

  // Filter hospitals: keep only MAJOR NHS/teaching hospitals
  // Exclude private hospitals (Nuffield, Spire, BMI, Bupa), mental health, walk-in centres
  if (includedType === 'hospital') {
    const excludePattern = /walk-in|clinic|health centre|gp |surgery|pharmacy|nuffield|spire|bmi |bupa|priory|private|mental|foss park|rehabilitation|care home|clifton park|outpatient/i;
    const majorPattern = /hospital|infirmary/i;
    const filtered = amenities.filter(
      (a) => majorPattern.test(a.name) && !excludePattern.test(a.name),
    );
    // If nothing passes the strict filter, relax to just "Hospital" keyword
    if (filtered.length === 0) {
      return amenities.filter((a) => majorPattern.test(a.name)).slice(0, 3);
    }
    return filtered.slice(0, 3);
  }

  // Filter universities: keep only actual universities, deduplicate by institution
  if (includedType === 'university') {
    const filtered = amenities.filter((a) => /university/i.test(a.name));

    // Deduplicate: extract the core university name
    // "King's Manor - University of York" → "university of york"
    // "University of York" → "university of york"
    // "Manchester Metropolitan University" → "manchester metropolitan university"
    const seen = new Set<string>();
    const deduped = filtered.filter((a) => {
      const name = a.name.toLowerCase();
      // Try to extract "University of X" or "X University" pattern
      const uniOfMatch = name.match(/university\s+of\s+[\w\s]+/);
      const xUniMatch = name.match(/[\w\s]+university/);
      const core = (uniOfMatch?.[0] ?? xUniMatch?.[0] ?? name).trim();
      if (seen.has(core)) return false;
      seen.add(core);
      return true;
    });
    return deduped.slice(0, 3);
  }

  return amenities;
}

export async function getNearbyAmenities(
  lat: number,
  lng: number,
): Promise<DemandDrivers> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in environment variables.');
  }

  const types = ['hospital', 'university', 'airport', 'train_station', 'bus_station', 'subway_station'] as const;

  const results = await Promise.allSettled(
    types.map((type) => searchNearbyByType(lat, lng, type, apiKey)),
  );

  const extract = (result: PromiseSettledResult<NearbyAmenity[]>): NearbyAmenity[] => {
    if (result.status === 'fulfilled') return result.value;
    console.error('Places search failed:', result.reason);
    return [];
  };

  return {
    hospitals: extract(results[0]),
    universities: extract(results[1]),
    airports: extract(results[2]),
    trainStations: extract(results[3]),
    busStations: extract(results[4]),
    subwayStations: extract(results[5]),
  };
}
