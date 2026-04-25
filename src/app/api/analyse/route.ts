import type { PropertyInput, AnalysisResult, ShortLetData, LongLetData, DemandDrivers, NearbyEvent, DataQuality } from '@/lib/types';
import { geocodePostcode } from '@/lib/apis/geocode';
import { getShortLetData } from '@/lib/apis/airbtics';
import { getLongLetData, getFloorArea } from '@/lib/apis/propertydata';
import { getNearbyAmenities } from '@/lib/apis/google-places';
import { getNearbyEvents } from '@/lib/apis/ticketmaster';
import { calculateFinancials, assessRisk, generateVerdict } from '@/lib/analysis';

// ─── Rate Limiter (in-memory, per IP) ────────────────────────────
// 10 requests per IP per 60-second window. Protects against API credit abuse.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Clean up stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000);

// ─── SSE Helper ──────────────────────────────────────────────────
function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  // Rate limiting
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  // Calibration bypass: dev-mode only, requires header with shared secret from .env
  const calibrationHeader = request.headers.get('x-calibration-bypass');
  const calibrationSecret = process.env.CALIBRATION_BYPASS_SECRET;
  const isCalibrationBypass =
    process.env.NODE_ENV !== 'production' &&
    calibrationSecret &&
    calibrationHeader === calibrationSecret;

  if (!isCalibrationBypass && isRateLimited(ip)) {
    return Response.json(
      { error: 'Too many requests. Please wait a minute before trying again.' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid request body.' },
      { status: 400 },
    );
  }

  // Validate input
  const { address, postcode, bedrooms, guests, bathrooms, parking, outdoorSpace, propertyType, monthlyMortgage, monthlyBills } = body as {
    address: unknown; postcode: unknown; bedrooms: unknown; guests: unknown;
    bathrooms: unknown; parking: unknown; outdoorSpace: unknown;
    propertyType: unknown;
    monthlyMortgage: unknown; monthlyBills: unknown;
  };

  const bathroomCount = Number(bathrooms);
  const validBathrooms = Number.isFinite(bathroomCount) && bathroomCount >= 1 ? bathroomCount : undefined;

  // Parking: map user selection to API numeric value
  const parkingMap: Record<string, number> = {
    'no_parking': 0,
    'on_street': 0,
    'allocated': 1,
    'garage': 1,
    'driveway_1': 1,
    'driveway_2': 2,
  };
  const validParking = typeof parking === 'string' && parking in parkingMap ? parking : 'no_parking';
  const parkingValue = parkingMap[validParking] ?? 0;
  const validHasParking = validParking !== 'no_parking' && validParking !== 'on_street';

  // Outdoor space: map to PropertyData format
  const outdoorMap: Record<string, string> = {
    'none': 'none',
    'balcony': 'balcony_terrace',
    'garden': 'garden',
    'roof_terrace': 'balcony_terrace',
  };
  const validOutdoorSpace = typeof outdoorSpace === 'string' && outdoorSpace in outdoorMap
    ? outdoorMap[outdoorSpace]
    : 'none';

  // Finish quality hardcoded to top spec — removed from form per client request.
  // All properties analysed at premium finish to prevent users re-entering specs,
  // wasting API credits, or getting confused when figures stay the same.
  const validFinishQuality = 'very_high';
  const validSpecialFeatures: string[] = [];

  if (!address || typeof address !== 'string' || (address as string).trim().length === 0) {
    return Response.json(
      { error: 'A valid property address is required.' },
      { status: 400 },
    );
  }

  if (!postcode || typeof postcode !== 'string' || (postcode as string).trim().length < 3) {
    return Response.json(
      { error: 'A valid UK postcode is required.' },
      { status: 400 },
    );
  }

  const bedroomCount = Number(bedrooms);
  if (!Number.isFinite(bedroomCount) || bedroomCount < 1 || bedroomCount > 10) {
    return Response.json(
      { error: 'Bedrooms must be a number between 1 and 10.' },
      { status: 400 },
    );
  }

  const guestCount = Number(guests);
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 16) {
    return Response.json(
      { error: 'Guests must be a number between 1 and 16.' },
      { status: 400 },
    );
  }

  const property: PropertyInput = {
    address: (address as string).trim(),
    postcode: (postcode as string).trim().toUpperCase(),
    bedrooms: bedroomCount,
    guests: guestCount,
  };

  // Map property type to PropertyData format
  const propertyTypeMap: Record<string, string> = {
    'Flat': 'flat',
    'Terraced': 'terraced_house',
    'Semi-detached': 'semi-detached_house',
    'Detached': 'detached_house',
    // Legacy values (backwards compat)
    'Terraced House': 'terraced_house',
    'Semi-Detached House': 'semi-detached_house',
    'Detached House': 'detached_house',
  };
  const mappedPropertyType = propertyType ? propertyTypeMap[propertyType as string] ?? 'flat' : 'flat';

  // ─── Streaming SSE Response ──────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)));
      };

      try {
        // ── Group 1 (parallel): Geocoding + (Short-let + Long-let) ──
        send({ stage: 'geocoding', progress: 10, message: 'Locating property...' });

        const geocodePromise = geocodePostcode(property.postcode);
        // Get floor area + build year from /floor-areas before calling valuation
        const floorAreaPromise = getFloorArea(property.postcode, property.address, property.bedrooms);

        // Wait for geocoding first — short-let now needs coordinates for nearby listings
        let coordinates: { lat: number; lng: number };
        try {
          coordinates = await geocodePromise;
        } catch (err) {
          console.error('Geocoding failed:', err);
          send({ stage: 'error', progress: 0, message: 'Could not geocode the provided postcode. Please check it and try again.' });
          controller.close();
          return;
        }

        send({ stage: 'geocoding', progress: 20, message: 'Property located' });

        // Wait for floor area data before starting long-let call
        const floorArea = await floorAreaPromise;

        const longLetPromise = getLongLetData(property.postcode, property.bedrooms, {
          propertyType: mappedPropertyType,
          constructionDate: floorArea.constructionDate,
          internalArea: floorArea.squareFeet,
          ...(validBathrooms && { bathrooms: validBathrooms }),
          finishQuality: validFinishQuality,
          outdoorSpace: validOutdoorSpace,
          offStreetParking: parkingValue,
        });

        // Now fetch short-let (needs coords) + long-let in parallel
        const shortLetPromise = getShortLetData(
          property.postcode,
          property.bedrooms,
          property.guests,
          coordinates.lat,
          coordinates.lng,
          {
            bathrooms: validBathrooms,
            hasParking: validHasParking,
            parkingSpaces: parkingValue,            // V3: for ADR feature multiplier
            finishQuality: validFinishQuality || undefined,
            outdoorSpace: validOutdoorSpace,        // V3
            propertyType: mappedPropertyType,       // V3
            specialFeatures: validSpecialFeatures,  // V3
          },
        );
        const [shortLetResult, longLetResult] = await Promise.allSettled([shortLetPromise, longLetPromise]);

        const shortLetRaw = shortLetResult.status === 'fulfilled'
          ? shortLetResult.value
          : {
              data: {
                annualRevenue: 0,
                monthlyRevenue: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as ShortLetData['monthlyRevenue'],
                occupancyRate: 0,
                averageDailyRate: 0,
                activeListings: 0,
                comparables: [],
              },
              quality: {
                comparablesFound: 0, comparablesTarget: 12,
                searchRadiusKm: 0, searchBroadened: false, level: 'low' as const,
                disclaimer: 'Unable to fetch short-term rental data. Book a web meeting with Stayful for a personalised assessment.',
              },
            };
        const shortLet: ShortLetData = shortLetRaw.data;
        const dataQuality: DataQuality = shortLetRaw.quality;

        const longLet: LongLetData = longLetResult.status === 'fulfilled'
          ? longLetResult.value
          : {
              monthlyRent: 0,
              estimateHigh: 0,
              estimateLow: 0,
              comparables: [],
            };

        if (shortLetResult.status === 'rejected') {
          console.error('Airbtics API failed:', shortLetResult.reason);
        }
        if (longLetResult.status === 'rejected') {
          console.error('PropertyData API failed:', longLetResult.reason);
        }

        send({ stage: 'short_let', progress: 40, message: 'Short-let revenue data received' });
        send({ stage: 'long_let', progress: 50, message: 'Long-let valuation received' });

        // ── Group 2 (parallel, needs geocoding): Amenities + Events ──
        send({ stage: 'amenities', progress: 55, message: 'Finding nearby amenities & transport...' });

        const [amenitiesResult, eventsResult] = await Promise.allSettled([
          getNearbyAmenities(coordinates.lat, coordinates.lng),
          getNearbyEvents(coordinates.lat, coordinates.lng),
        ]);

        const demandDrivers: DemandDrivers = amenitiesResult.status === 'fulfilled'
          ? amenitiesResult.value
          : {
              hospitals: [],
              universities: [],
              airports: [],
              trainStations: [],
              busStations: [],
              subwayStations: [],
            };

        const nearbyEvents: { events: NearbyEvent[]; totalEvents: number } =
          eventsResult.status === 'fulfilled'
            ? eventsResult.value
            : { events: [], totalEvents: 0 };

        if (amenitiesResult.status === 'rejected') {
          console.error('Google Places API failed:', amenitiesResult.reason);
        }
        if (eventsResult.status === 'rejected') {
          console.error('Ticketmaster API failed:', eventsResult.reason);
        }

        send({ stage: 'amenities', progress: 75, message: 'Nearby amenities found' });
        send({ stage: 'events', progress: 80, message: 'Local events discovered' });

        // ── Final: Run analysis ──────────────────────────────────────
        send({ stage: 'analysis', progress: 90, message: 'Running financial analysis...' });

        const financials = calculateFinancials(shortLet, longLet);
        const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents);
        const verdict = generateVerdict(financials, risk);

        const now = new Date().toISOString();

        const result: AnalysisResult = {
          property,
          coordinates,
          shortLet,
          longLet,
          demandDrivers,
          nearbyEvents,
          financials,
          dataQuality,
          risk,
          verdict,
          createdAt: now,
          updatedAt: now,
        };

        send({ stage: 'complete', progress: 100, message: 'Analysis complete', data: result });
      } catch (err) {
        console.error('Unexpected error in /api/analyse:', err);
        send({ stage: 'error', progress: 0, message: 'An unexpected error occurred. Please try again.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
