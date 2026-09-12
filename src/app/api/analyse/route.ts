import type { PropertyInput, AnalysisResult, ShortLetData, LongLetData, DemandDrivers, NearbyEvent, DataQuality } from '@/lib/types';
import { geocodePostcode } from '@/lib/apis/geocode';
import { getShortLetData } from '@/lib/apis/airbtics';
import { getLongLetData, getFloorArea, fetchPropertyValuation } from '@/lib/apis/propertydata';
import { getNearbyAmenities } from '@/lib/apis/google-places';
import { getNearbyEvents } from '@/lib/apis/ticketmaster';
import { fetchPriceLabsRevenueEstimate, buildCrossValidation } from '@/lib/apis/pricelabs';
import { calculateFinancials, assessRisk, generateVerdict } from '@/lib/analysis';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { startAction, actionSpend } from '@/lib/credit/action';
import { runMetered } from '@/lib/credit/context';
import { estimateAction, reportAction } from '@/lib/credit/estimate';
import { getUnitCostTable } from '@/lib/credit/unit-costs';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { ask, nearbyListings, listingPerformance, strSecondOpinion } from '@/lib/broker';
import { matchTracked, rankCompetitors, summariseCompetitors } from '@/lib/listing/competitors';
import { purchaseDeal, rentToRentDeal, monthlyCashflow } from '@/lib/listing/deal';
import { detectListingUrl } from '@/lib/listing/detect';
import { postcodeAreaOf } from '@/lib/listing/normalise';
import { parseMarketGoals, DEFAULT_FINANCE_GOALS, type FinanceGoals } from '@/lib/market/goals';
import type { CompetitorsResult, DealResult, SourceListingRef } from '@/lib/types';

// This route streams SSE while making several sequential external API
// calls; the default 10s function timeout (Hobby) would cut the stream
// off mid-flight, surfacing as "Could not reach the server".
export const maxDuration = 60;

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

  // Auth + free-reports gate. Calibration bypass skips this (dev-only).
  let userId: string | null = null;
  let userEmail: string | null = null;
  let userName: string | null = null;
  let userMobile: string | null = null;
  let finance: FinanceGoals = DEFAULT_FINANCE_GOALS;
  let isAdmin = false;
  if (!isCalibrationBypass) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json(
        { error: 'You need to sign in to run an analysis.' },
        { status: 401 },
      );
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, mobile, market_goals')
      .eq('id', user.id)
      .single();
    if (!profile) {
      return Response.json({ error: 'Your account is not set up yet. Please sign in again.' }, { status: 403 });
    }
    isAdmin = isAdminEmail(user.email);
    userName = profile.full_name ?? null;
    userMobile = profile.mobile ?? null;
    userId = user.id;
    userEmail = user.email ?? null;
    finance = parseMarketGoals(profile.market_goals)?.finance ?? DEFAULT_FINANCE_GOALS;
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
  const { address, postcode, email, bedrooms, guests, bathrooms, parking, outdoorSpace, propertyType, purchasePrice, advertisedRent, sourceListing, checkedListingId, enhanced } = body as {
    address: unknown; postcode: unknown; email: unknown;
    bedrooms: unknown; guests: unknown;
    bathrooms: unknown; parking: unknown; outdoorSpace: unknown;
    propertyType: unknown;
    purchasePrice: unknown; advertisedRent: unknown; sourceListing: unknown; checkedListingId: unknown; enhanced: unknown;
  };
  // Standard report = Airbtics + PropertyData. Enhanced adds the PMI second
  // opinion (50 PMI credits), chosen per report on the form; PMI_SECOND_OPINION=false is the kill switch.
  const wantEnhanced = enhanced === true && process.env.PMI_SECOND_OPINION !== 'false';
  const emailStr = typeof email === 'string' && email.includes('@') ? email.trim() : null;

  // ── Listing-link inputs (all optional) ──
  const money = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v) : null);
  const askingPrice = money(purchasePrice, 50_000_000);
  const rentPcm = money(advertisedRent, 50_000);
  let source: SourceListingRef | null = null;
  if (sourceListing && typeof sourceListing === 'object') {
    const sl = sourceListing as Record<string, unknown>;
    const detected = typeof sl.url === 'string' ? detectListingUrl(sl.url) : null;
    if (detected) {
      source = {
        url: detected.canonicalUrl,
        source: detected.source,
        kind: sl.kind === 'rent' ? 'rent' : sl.kind === 'str' ? 'str' : 'sale',
        title: typeof sl.title === 'string' ? sl.title.slice(0, 200) : undefined,
        photo: typeof sl.photo === 'string' && /^https:\/\//.test(sl.photo) ? sl.photo.slice(0, 500) : undefined,
      };
      if (askingPrice && source.kind === 'sale') source.price = { amount: askingPrice, period: 'total' };
      if (rentPcm && source.kind === 'rent') source.price = { amount: rentPcm, period: 'pcm' };
    }
  }
  const checkedId = typeof checkedListingId === 'string' && /^[0-9a-f-]{36}$/i.test(checkedListingId) ? checkedListingId : null;

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

  // Changed from 'very_high' to 'average' — hardcoded 1.38x condition multiplier
  // was inflating every property estimate by 38% regardless of actual finish quality.
  // PMI applies no quality multiplier to the headline figure.
  const validFinishQuality = 'average';
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
  if (!Number.isFinite(bedroomCount) || bedroomCount < 0 || bedroomCount > 10) {
    return Response.json(
      { error: 'Bedrooms must be a number between 0 and 10.' },
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

  // ─── Credit: reserve the worst-case cost before anything is spent ─────
  // Every provider call below is metered against this action (see
  // src/lib/credit/meter.ts); the reservation guarantees the report can
  // never run partially unpaid. Admins run free; shadow mode never blocks.
  const priceLabsEnabled = process.env.PRICELABS_AS_PRIMARY === 'true';
  const reportKind = reportAction(wantEnhanced);
  const estimate = estimateAction(await getUnitCostTable(), reportKind, { priceLabs: priceLabsEnabled });
  let action;
  try {
    action = await startAction({ userId, admin: isAdmin || Boolean(isCalibrationBypass), action: reportKind, maxBasePence: estimate.maxBasePence });
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, reportKind);
    throw err;
  }
  const meterCtx = action.ctx;
  const finishAction = action.finish;

  // ─── Streaming SSE Response ──────────────────────────────────
  const stream = runMetered(meterCtx, () => new ReadableStream({
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
        // PriceLabs Revenue Estimator is gated behind PRICELABS_AS_PRIMARY
        // env var. When unset (the default), PriceLabs is NOT called at all
        // — saves trial credits and keeps the existing Airbtics-V4 pipeline
        // as the sole headline source. To re-enable PriceLabs as primary,
        // set PRICELABS_AS_PRIMARY=true in Vercel and redeploy.
        //
        // When enabled and successful, PriceLabs RE OVERRIDES the V4
        // headline below. When it fails (missing key, 401, 429 quota
        // exhausted, 500), V4 result stays unchanged.
        const priceLabsPromise: Promise<Awaited<ReturnType<typeof fetchPriceLabsRevenueEstimate>>> = priceLabsEnabled
          ? fetchPriceLabsRevenueEstimate({
              address: property.address,
              bedrooms: property.bedrooms,
              lat: coordinates.lat,
              lng: coordinates.lng,
              currency: 'GBP',
            })
          : Promise.resolve(null);
        if (!priceLabsEnabled) {
          console.log('[PriceLabs RE] disabled (PRICELABS_AS_PRIMARY not set) — using Airbtics-V4 only');
        }

        // Sale valuation runs in parallel — never blocks or throws
        const saleValuationPromise = fetchPropertyValuation(
          property.postcode,
          property.bedrooms,
          mappedPropertyType,
        );

        // ── Listing-link extras, in parallel with the main calls ──
        // Tracked competitors within 1 km (one 5p bounds call per cell per
        // week) and, when the member pasted an Airbnb, that listing's own
        // figures. PMI second opinion is 50 credits so it only runs here, in
        // a full report, and only within its daily budget.
        const brokerCtx = { mode: 'full' as const, userId };
        const competitorsPromise = (async (): Promise<CompetitorsResult | null> => {
          const near = await ask(nearbyListings, { lat: coordinates.lat, lng: coordinates.lng }, brokerCtx);
          const list = near.value;
          const airbnbId = source?.source === 'airbnb' ? source.url.match(/\/rooms\/(\d+)/)?.[1] ?? null : null;
          let tracked = airbnbId && list ? matchTracked(list, airbnbId) : null;
          let provider = near.provider;
          if (airbnbId && !tracked) {
            const perf = await ask(listingPerformance, { listingId: airbnbId, lat: coordinates.lat, lng: coordinates.lng }, brokerCtx);
            tracked = perf.value;
            if (tracked) provider = perf.provider;
          }
          if (!list && !tracked) return null;
          return {
            summary: summariseCompetitors(list ?? [], property.bedrooms),
            top: rankCompetitors(list ?? [], 8),
            tracked,
            trackedMissing: Boolean(airbnbId) && !tracked,
            provider,
            updatedAt: near.updatedAt,
          };
        })().catch((err) => {
          console.error('[analyse] competitors failed:', err);
          return null;
        });
        const secondOpinionPromise = (async () => {
          if (!wantEnhanced) return null;
          const r = await ask(
            strSecondOpinion,
            { postcode: property.postcode, bedrooms: property.bedrooms, bathrooms: validBathrooms, propertyType: mappedPropertyType === 'flat' ? 'apartment' : 'house' },
            brokerCtx,
          );
          return r.value ? { ...r.value, provider: 'pmi' as const, updatedAt: r.updatedAt } : null;
        })().catch((err) => {
          console.error('[analyse] second opinion failed:', err);
          return null;
        });

        const [shortLetResult, longLetResult, priceLabsResult, saleValuationResult] = await Promise.allSettled([
          shortLetPromise,
          longLetPromise,
          priceLabsPromise,
          saleValuationPromise,
        ]);

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

        // PriceLabs Revenue Estimator override.
        // If the trial/subscription returned a successful estimate, it
        // becomes the primary headline source — we overwrite shortLet.* with
        // PriceLabs values BEFORE running financials. The V4-on-Airbtics
        // result is preserved in crossValidation.airbticsRevenue for
        // transparency but no longer drives the headline.
        const priceLabsData = priceLabsResult.status === 'fulfilled' ? priceLabsResult.value : null;
        if (priceLabsResult.status === 'rejected') {
          console.error('[PriceLabs RE] promise rejected:', priceLabsResult.reason);
        }

        const propertyValuation = saleValuationResult.status === 'fulfilled'
          ? saleValuationResult.value
          : null;
        if (saleValuationResult.status === 'rejected') {
          console.error('[PropertyData] sale valuation promise rejected:', (saleValuationResult as PromiseRejectedResult).reason);
        }
        const crossValidation = buildCrossValidation(shortLet.annualRevenue, priceLabsData);

        if (priceLabsData) {
          // Override headline: replace V4 numbers with PriceLabs RE numbers.
          // Comparables stay as Airbtics-sourced (PriceLabs RE doesn't
          // expose individual comp listings, only aggregates).
          shortLet.annualRevenue = priceLabsData.annualRevenue;
          shortLet.averageDailyRate = priceLabsData.adr;
          shortLet.occupancyRate = priceLabsData.occupancy;
          // PriceLabs gives us 12 monthly values — use directly.
          // Cast required: ShortLetData expects a fixed-length tuple.
          const padded: number[] = [...priceLabsData.monthlyRevenue];
          while (padded.length < 12) padded.push(0);
          shortLet.monthlyRevenue = padded.slice(0, 12) as ShortLetData['monthlyRevenue'];
          console.log(`[PriceLabs RE] overrode headline: was £${crossValidation.airbticsRevenue}, now £${priceLabsData.annualRevenue} (range £${priceLabsData.rangeLow}-£${priceLabsData.rangeHigh})`);
        }
        console.log(`[PriceLabs RE] crossValidation: source=${crossValidation.source}, confidence=${crossValidation.confidence}, divergence=${crossValidation.divergencePct?.toFixed(1) ?? 'n/a'}%`);

        // Re-run financials with the (possibly overridden) shortLet values
        const financials = calculateFinancials(shortLet, longLet);
        const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents);
        const verdict = generateVerdict(financials, risk);

        const now = new Date().toISOString();

        // ── Deal maths on the asking price / advertised rent (or the estimated value) ──
        const [competitors, secondOpinion] = await Promise.all([competitorsPromise, secondOpinionPromise]);
        const dealBase = { grossRevenue: shortLet.annualRevenue, adr: shortLet.averageDailyRate, bedrooms: property.bedrooms, finance };
        let deal: DealResult | null = null;
        if (rentPcm) deal = { ...rentToRentDeal(rentPcm, dealBase), basis: 'advertised-rent' };
        else if (askingPrice) deal = { ...purchaseDeal(askingPrice, dealBase), basis: 'asking-price' };
        else if (propertyValuation?.estimatedValue) deal = { ...purchaseDeal(propertyValuation.estimatedValue, dealBase), basis: 'estimated-value' };
        const fixedPcm = deal?.kind === 'rent-to-rent' ? deal.advertisedRentPcm : deal?.kind === 'purchase' ? deal.mortgageMonthly : 0;
        const cashflow = shortLet.annualRevenue > 0 ? monthlyCashflow(shortLet.monthlyRevenue, fixedPcm) : null;

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
          crossValidation,
          propertyValuation,
          sourceListing: source,
          deal,
          cashflow,
          competitors,
          secondOpinion,
        };

        // Persist the report so it can be reopened from /reports, and link it
        // to the checked listing it came from. Done before `complete` so the
        // client receives the report id with the result.
        if (userId) {
          try {
            const supabase = await createSupabaseServerClient();
            const { data: saved, error: saveError } = await supabase
              .from('saved_searches')
              .insert({
                user_id: userId,
                name: property.address,
                address: property.address,
                postcode: property.postcode,
                postcode_area: postcodeAreaOf(property.postcode),
                guest_count: property.guests,
                bedrooms: property.bedrooms,
                kind: source?.kind ?? (rentPcm ? 'rent' : 'sale'),
                result,
                source_listing: source,
                deal,
                checked_listing_id: checkedId,
              })
              .select('id')
              .single();
            if (saveError) console.error('[api/analyse] report save failed:', saveError.message);
            else if (saved?.id) {
              result.reportId = saved.id as string;
              if (checkedId) {
                await supabase.from('checked_listings').update({ analysed_report_id: saved.id, updated_at: now }).eq('id', checkedId).eq('user_id', userId);
              }
              // Keep the last 200 reports per member.
              const { data: older } = await supabase.from('saved_searches').select('id').eq('user_id', userId).order('created_at', { ascending: false }).range(200, 400);
              if (older && older.length > 0) {
                await supabase.from('saved_searches').delete().in('id', older.map((r) => r.id));
              }
            }
          } catch (err) {
            console.error('[api/analyse] report save threw:', err);
          }
        }

        // What this report actually used, so the UI can show it.
        const spend = userId ? await actionSpend(meterCtx.actionId).catch(() => ({ basePence: 0, chargedPence: 0 })) : { basePence: 0, chargedPence: 0 };
        send({ stage: 'complete', progress: 100, message: 'Analysis complete', data: result, credit: { actionId: meterCtx.actionId, basePence: spend.basePence, chargedPence: spend.chargedPence } });

        // Generate the PDF report and upload it to the user's enquiry row
        // (Monday "Reports" file column), matched by email. Awaited before
        // closing the stream so Vercel doesn't kill the function mid-upload.
        const effectiveEmail = emailStr ?? userEmail;
        if (effectiveEmail) {
          try {
            const { uploadPdfToMonday } = await import('@/lib/apis/monday');
            const React = await import('react');
            const { renderToBuffer } = await import('@react-pdf/renderer');
            const { deriveReportData, buildPdfDeal, sanitiseAddressForFilename } = await import('@/lib/pdf/derive');
            const { StayfulReport } = await import('@/lib/pdf/StayfulReport');
            const data = deriveReportData(result);
            data.deal = buildPdfDeal(result);
            const element = React.createElement(StayfulReport, { data });
            const buffer = await (renderToBuffer as (e: unknown) => Promise<Buffer>)(element);
            const filename = `Stayful_Property_Analysis_${sanitiseAddressForFilename(result.property.address)}.pdf`;
            await uploadPdfToMonday(
              { email: effectiveEmail, name: userName ?? undefined, mobile: userMobile ?? undefined },
              buffer,
              filename,
            );
          } catch (err) {
            console.error('[Monday] PDF upload error:', err);
          }
        }

        // Usage is metered per provider call (credit ledger). reports_total is
        // a reporting counter only, written with the service-role client: the
        // usage counters are not grantable to `authenticated` (see the column
        // grants in supabase/schema.sql).
        if (userId) {
          try {
            const admin = createAdminClient();
            const { data: current } = await admin.from('profiles').select('reports_total').eq('id', userId).single();
            await admin
              .from('profiles')
              .update({ last_seen_at: new Date().toISOString(), reports_total: (current?.reports_total ?? 0) + 1 })
              .eq('id', userId);
          } catch (err) {
            console.error('[api/analyse] usage hook failed:', err);
          }
        }
      } catch (err) {
        console.error('Unexpected error in /api/analyse:', err);
        send({ stage: 'error', progress: 0, message: 'An unexpected error occurred. Please try again.' });
      } finally {
        await finishAction().catch(() => {});
        controller.close();
      }
    },
  }));

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
