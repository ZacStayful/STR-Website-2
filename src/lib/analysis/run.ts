import 'server-only';

import type {
  AnalysisResult, ShortLetData, LongLetData, DemandDrivers, NearbyEvent, DataQuality,
  CompetitorsResult, DealResult,
} from '../types';
import { geocodePostcode } from '../apis/geocode';
import { getShortLetData } from '../apis/airbtics';
import { getLongLetData, getFloorArea, fetchPropertyValuation } from '../apis/propertydata';
import { getNearbyAmenities } from '../apis/google-places';
import { getNearbyEvents } from '../apis/ticketmaster';
import { fetchPriceLabsRevenueEstimate, buildCrossValidation } from '../apis/pricelabs';
import { calculateFinancials, assessRisk, generateVerdict } from '../analysis.ts';
import { startAction, actionSpend } from '../credit/action';
import { runMetered, type MeterContext } from '../credit/context';
import { estimateAction, reportAction, type CreditAction } from '../credit/estimate';
import { getUnitCostTable } from '../credit/unit-costs';
import { ask, nearbyListings, listingPerformance, strSecondOpinion } from '../broker';
import { matchTracked, rankCompetitors, summariseCompetitors } from '../listing/competitors';
import { purchaseDeal, rentToRentDeal, monthlyCashflow } from '../listing/deal';
import { DEFAULT_FINANCE_GOALS, type FinanceGoals } from '../market/goals';
import type { AnalysisInput } from './input';

/**
 * One property analysis, end to end: geocode, short-let and long-let data,
 * demand drivers, deal maths and the verdict.
 *
 * Lifted out of `/api/analyse` so the same pipeline can serve the SSE route,
 * the public funnel and the v1 API. Progress is reported through `onProgress`
 * rather than written to a stream, and the caller decides what to do with the
 * result — persist it, render a PDF, push it to a CRM. Nothing here writes to
 * the database beyond the credit ledger.
 *
 * Billing: the worst-case cost is reserved up front and every provider call
 * below is metered against it (see `src/lib/credit/meter.ts`), so a report can
 * never run partially unpaid. `billedUserId` is who pays — for a funnel lead
 * that is the funnel's owner, not the person filling in the form.
 */

export interface AnalysisRunOptions {
  /** Who pays. null is house spend: logged, never charged (calibration runs). */
  billedUserId: string | null;
  /** Admins run everything free; usage is still logged, with bypass = true. */
  admin?: boolean;
  /** Finance assumptions behind the deal maths. Defaults when not supplied. */
  finance?: FinanceGoals;
  onProgress?: (event: { stage: string; progress: number; message: string }) => void;
}

/**
 * A reservation held against the member's credit, plus the metering context
 * the run happens under. Produced by `reserveAnalysis`, consumed once by
 * `runAnalysis`, which always releases it.
 */
export interface PreparedAnalysis {
  ctx: MeterContext;
  finish: () => Promise<void>;
  /** 'report' or 'report_enhanced' — the action the reservation was priced as. */
  reportKind: CreditAction;
  /** Worst-case base pence held for this run. */
  maxBasePence: number;
}

export interface AnalysisRun {
  result: AnalysisResult;
  /** Ties every provider call and debit of this run together. */
  actionId: string;
  spend: { basePence: number; chargedPence: number };
}

/** The postcode could not be geocoded — nothing downstream can run. */
export class GeocodeError extends Error {
  constructor() {
    super('Could not geocode the provided postcode. Please check it and try again.');
    this.name = 'GeocodeError';
  }
}

// Was 'very_high': a hardcoded 1.38x condition multiplier inflated every
// estimate by 38% regardless of actual finish. PMI applies no quality
// multiplier to the headline figure, so neither do we.
const FINISH_QUALITY = 'average';
const SPECIAL_FEATURES: string[] = [];

/** True when the member asked for the PMI second opinion and it is switched on. */
export function enhancedEnabled(requested: boolean): boolean {
  return requested && process.env.PMI_SECOND_OPINION !== 'false';
}

/**
 * PriceLabs Revenue Estimator is gated behind PRICELABS_AS_PRIMARY. When unset
 * (the default) PriceLabs is not called at all — it saves trial credits and
 * keeps the Airbtics-V4 pipeline as the sole headline source.
 */
function priceLabsEnabled(): boolean {
  return process.env.PRICELABS_AS_PRIMARY === 'true';
}

/**
 * Reserves the worst-case cost of the run. Throws `InsufficientCreditError`
 * when the member cannot cover it, which is deliberately a separate step from
 * `runAnalysis`: callers serving HTTP need to turn that into a 402 *before*
 * they start streaming a response body.
 */
export async function reserveAnalysis(input: AnalysisInput, opts: AnalysisRunOptions): Promise<PreparedAnalysis> {
  const reportKind = reportAction(enhancedEnabled(input.enhancedRequested));
  const estimate = estimateAction(await getUnitCostTable(), reportKind, { priceLabs: priceLabsEnabled() });
  const action = await startAction({
    userId: opts.billedUserId,
    admin: Boolean(opts.admin),
    action: reportKind,
    maxBasePence: estimate.maxBasePence,
  });
  return { ctx: action.ctx, finish: action.finish, reportKind, maxBasePence: estimate.maxBasePence };
}

export async function runAnalysis(
  prepared: PreparedAnalysis,
  input: AnalysisInput,
  opts: AnalysisRunOptions,
): Promise<AnalysisRun> {
  const { property } = input;
  const userId = opts.billedUserId;
  const finance = opts.finance ?? DEFAULT_FINANCE_GOALS;
  const progress = (stage: string, pct: number, message: string) => opts.onProgress?.({ stage, progress: pct, message });

  const wantEnhanced = enhancedEnabled(input.enhancedRequested);
  const priceLabs = priceLabsEnabled();
  const { ctx, finish } = prepared;

  return runMetered(ctx, async (): Promise<AnalysisRun> => {
    try {
      // ── Group 1 (parallel): Geocoding + (Short-let + Long-let) ──
      progress('geocoding', 10, 'Locating property...');

      const geocodePromise = geocodePostcode(property.postcode);
      // Floor area + build year come from /floor-areas before valuation.
      const floorAreaPromise = getFloorArea(property.postcode, property.address, property.bedrooms);

      // Geocoding first — short-let needs coordinates for nearby listings.
      let coordinates: { lat: number; lng: number };
      try {
        coordinates = await geocodePromise;
      } catch (err) {
        console.error('Geocoding failed:', err);
        throw new GeocodeError();
      }

      progress('geocoding', 20, 'Property located');

      const floorArea = await floorAreaPromise;

      const longLetPromise = getLongLetData(property.postcode, property.bedrooms, {
        propertyType: input.propertyType,
        constructionDate: floorArea.constructionDate,
        internalArea: floorArea.squareFeet,
        ...(input.bathrooms && { bathrooms: input.bathrooms }),
        finishQuality: FINISH_QUALITY,
        outdoorSpace: input.outdoorSpace,
        offStreetParking: input.parkingSpaces,
      });

      const shortLetPromise = getShortLetData(
        property.postcode,
        property.bedrooms,
        property.guests,
        coordinates.lat,
        coordinates.lng,
        {
          bathrooms: input.bathrooms,
          hasParking: input.hasParking,
          parkingSpaces: input.parkingSpaces,
          finishQuality: FINISH_QUALITY,
          outdoorSpace: input.outdoorSpace,
          propertyType: input.propertyType,
          specialFeatures: SPECIAL_FEATURES,
        },
      );

      // When enabled and successful, PriceLabs overrides the V4 headline
      // below. When it fails (missing key, 401, 429, 500) V4 stays.
      const priceLabsPromise: Promise<Awaited<ReturnType<typeof fetchPriceLabsRevenueEstimate>>> = priceLabs
        ? fetchPriceLabsRevenueEstimate({
            address: property.address,
            bedrooms: property.bedrooms,
            lat: coordinates.lat,
            lng: coordinates.lng,
            currency: 'GBP',
          })
        : Promise.resolve(null);
      if (!priceLabs) {
        console.log('[PriceLabs RE] disabled (PRICELABS_AS_PRIMARY not set) — using Airbtics-V4 only');
      }

      // Sale valuation runs in parallel — never blocks or throws.
      const saleValuationPromise = fetchPropertyValuation(property.postcode, property.bedrooms, input.propertyType);

      // ── Listing-link extras, in parallel with the main calls ──
      // Tracked competitors within 1 km (one 5p bounds call per cell per
      // week) and, when an Airbnb was pasted, that listing's own figures.
      // The PMI second opinion is 50 credits, so it only runs in a full
      // report and only within its daily budget.
      const source = input.sourceListing;
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
          {
            postcode: property.postcode,
            bedrooms: property.bedrooms,
            bathrooms: input.bathrooms,
            propertyType: input.propertyType === 'flat' ? 'apartment' : 'house',
          },
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
        : { monthlyRent: 0, estimateHigh: 0, estimateLow: 0, comparables: [] };

      if (shortLetResult.status === 'rejected') console.error('Airbtics API failed:', shortLetResult.reason);
      if (longLetResult.status === 'rejected') console.error('PropertyData API failed:', longLetResult.reason);

      progress('short_let', 40, 'Short-let revenue data received');
      progress('long_let', 50, 'Long-let valuation received');

      // ── Group 2 (parallel, needs geocoding): Amenities + Events ──
      progress('amenities', 55, 'Finding nearby amenities & transport...');

      const [amenitiesResult, eventsResult] = await Promise.allSettled([
        getNearbyAmenities(coordinates.lat, coordinates.lng),
        getNearbyEvents(coordinates.lat, coordinates.lng),
      ]);

      const demandDrivers: DemandDrivers = amenitiesResult.status === 'fulfilled'
        ? amenitiesResult.value
        : { hospitals: [], universities: [], airports: [], trainStations: [], busStations: [], subwayStations: [] };

      const nearbyEvents: { events: NearbyEvent[]; totalEvents: number } = eventsResult.status === 'fulfilled'
        ? eventsResult.value
        : { events: [], totalEvents: 0 };

      if (amenitiesResult.status === 'rejected') console.error('Google Places API failed:', amenitiesResult.reason);
      if (eventsResult.status === 'rejected') console.error('Ticketmaster API failed:', eventsResult.reason);

      progress('amenities', 75, 'Nearby amenities found');
      progress('events', 80, 'Local events discovered');

      // ── Final: run the analysis ──
      progress('analysis', 90, 'Running financial analysis...');

      const priceLabsData = priceLabsResult.status === 'fulfilled' ? priceLabsResult.value : null;
      if (priceLabsResult.status === 'rejected') {
        console.error('[PriceLabs RE] promise rejected:', priceLabsResult.reason);
      }

      const propertyValuation = saleValuationResult.status === 'fulfilled' ? saleValuationResult.value : null;
      if (saleValuationResult.status === 'rejected') {
        console.error('[PropertyData] sale valuation promise rejected:', (saleValuationResult as PromiseRejectedResult).reason);
      }
      const crossValidation = buildCrossValidation(shortLet.annualRevenue, priceLabsData);

      if (priceLabsData) {
        // Override the headline with PriceLabs numbers. Comparables stay
        // Airbtics-sourced: PriceLabs RE exposes aggregates, not listings.
        shortLet.annualRevenue = priceLabsData.annualRevenue;
        shortLet.averageDailyRate = priceLabsData.adr;
        shortLet.occupancyRate = priceLabsData.occupancy;
        // Cast required: ShortLetData expects a fixed-length tuple.
        const padded: number[] = [...priceLabsData.monthlyRevenue];
        while (padded.length < 12) padded.push(0);
        shortLet.monthlyRevenue = padded.slice(0, 12) as ShortLetData['monthlyRevenue'];
        console.log(`[PriceLabs RE] overrode headline: was £${crossValidation.airbticsRevenue}, now £${priceLabsData.annualRevenue} (range £${priceLabsData.rangeLow}-£${priceLabsData.rangeHigh})`);
      }
      console.log(`[PriceLabs RE] crossValidation: source=${crossValidation.source}, confidence=${crossValidation.confidence}, divergence=${crossValidation.divergencePct?.toFixed(1) ?? 'n/a'}%`);

      // Financials run on the (possibly overridden) shortLet values.
      const financials = calculateFinancials(shortLet, longLet);
      const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents);
      const verdict = generateVerdict(financials, risk);

      const now = new Date().toISOString();

      // ── Deal maths on the asking price / advertised rent (or the estimate) ──
      const [competitors, secondOpinion] = await Promise.all([competitorsPromise, secondOpinionPromise]);
      const dealBase = { grossRevenue: shortLet.annualRevenue, adr: shortLet.averageDailyRate, bedrooms: property.bedrooms, finance };
      let deal: DealResult | null = null;
      if (input.rentPcm) deal = { ...rentToRentDeal(input.rentPcm, dealBase), basis: 'advertised-rent' };
      else if (input.askingPrice) deal = { ...purchaseDeal(input.askingPrice, dealBase), basis: 'asking-price' };
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

      // What this report actually used, so the caller can show it.
      const spend = userId
        ? await actionSpend(ctx.actionId).catch(() => ({ basePence: 0, chargedPence: 0 }))
        : { basePence: 0, chargedPence: 0 };

      return { result, actionId: ctx.actionId, spend };
    } finally {
      await finish().catch(() => {});
    }
  });
}
