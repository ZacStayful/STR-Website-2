import 'server-only';

import type {
  AnalysisResult, ShortLetData, LongLetData, DemandDrivers, NearbyEvent, DataQuality,
  CompetitorsResult, DealResult,
} from '../types';
import { geocodePostcode } from '../apis/geocode';
import { getShortLetData } from '../apis/airbtics';
import { dueDiligenceFor, floorAreaFor, longLetFor, saleValuationFor } from './propertydata-steps';
import { getNearbyAmenities } from '../apis/google-places';
import { getNearbyEvents } from '../apis/ticketmaster';
import { fetchPriceLabsRevenueEstimate, buildCrossValidation } from '../apis/pricelabs';
import { calculateFinancials, assessRisk, generateVerdict } from '../analysis.ts';
import { startAction, actionSpend } from '../credit/action';
import { runMetered, type MeterContext } from '../credit/context';
import { estimateAction, reportAction, type CreditAction } from '../credit/estimate';
import { getUnitCostTable } from '../credit/unit-costs';
import { ask, nearbyListings, listingPerformance, strSecondOpinion, pdCouncilTax, pdMortgageRates, pdRegionKeyStats, pdStampDuty } from '../broker';
import { matchTracked, rankCompetitors, summariseCompetitors } from '../listing/competitors';
import { purchaseDeal, rentToRentDeal, monthlyCashflow } from '../listing/deal';
import { billsFromCouncilTax, pickCouncilTaxBand } from '../listing/bills';
import { countryForPostcode, stampDutyFromApi, type StampDutyFigure } from '../listing/stamp-duty';
import { liveMortgageRate, type MortgageRateInfo } from '../listing/mortgage-rate';
import { futureValueRange } from '../listing/growth';
import { keyStatsForOutcode, outcodeGrowth, pdRegionForOutcode } from '../market/key-stats';
import { outcodeOf } from '../apis/propertydata-parse';
import { DEFAULT_FINANCE_GOALS, type FinanceGoals } from '../market/goals';
import type { AnalysisInput } from './input';
import { noticeForFailure, noticeForEmptyResult, type EnhancedNotice } from './enhanced-notice';

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
  /** Price at this multiplier instead of each unit row's own (funnel leads: 2). */
  markupOverride?: number;
  /**
   * The funnel this run belongs to, when it is a lead. Tags each debit so
   * the billing history can tell a lead from the member's own research.
   *
   * Read by `reserveAnalysis` only. `runAnalysis` re-enters the context the
   * reservation already built, so passing it there again would do nothing —
   * the same is true of `markupOverride` above.
   */
  funnelId?: string | null;
  /**
   * Refuse an unaffordable run even when CREDIT_ENFORCE is off. Public
   * callers must pass this: shadow mode is a safety net for members, not
   * permission for a stranger's request to spend a customer's money.
   */
  requireCredit?: boolean;
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
  const estimate = estimateAction(await getUnitCostTable(), reportKind, {
    priceLabs: priceLabsEnabled(),
    markupOverride: opts.markupOverride,
  });
  const action = await startAction({
    userId: opts.billedUserId,
    admin: Boolean(opts.admin),
    action: reportKind,
    maxBasePence: estimate.maxBasePence,
    markupOverride: opts.markupOverride,
    requireCredit: opts.requireCredit,
    funnelId: opts.funnelId,
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
  const progress = (stage: string, pct: number, message: string) => opts.onProgress?.({ stage, progress: pct, message });

  const wantEnhanced = enhancedEnabled(input.enhancedRequested);
  const priceLabs = priceLabsEnabled();
  const { ctx, finish } = prepared;

  return runMetered(ctx, async (): Promise<AnalysisRun> => {
    try {
      // ── Group 1 (parallel): Geocoding + (Short-let + Long-let) ──
      progress('geocoding', 10, 'Locating property...');

      // Every PropertyData, Airbtics and PMI question below goes through the
      // broker under this context: cached answers are reused, paid calls are
      // metered to the member and capped by the daily budgets.
      const brokerCtx = { mode: 'full' as const, userId };

      const geocodePromise = geocodePostcode(property.postcode);

      // Geocoding first — short-let needs coordinates for nearby listings.
      let coordinates: { lat: number; lng: number; locality?: string };
      try {
        coordinates = await geocodePromise;
      } catch (err) {
        console.error('Geocoding failed:', err);
        throw new GeocodeError();
      }

      progress('geocoding', 20, 'Property located');

      // Only once the postcode has geocoded, so a report that fails here
      // has not charged the payer for a dozen PropertyData calls. Floor
      // area comes from /floor-areas before the valuations. The council
      // tax band and the national mortgage averages are only needed by the
      // deal maths at the end; they start now so they add no time. The
      // averages are bought once a day by the market-warm cron and a report
      // only ever reads them.
      const floorAreaPromise = floorAreaFor(property.postcode, property.address, property.bedrooms, brokerCtx);
      const councilTaxPromise = ask(pdCouncilTax, { postcode: property.postcode }, brokerCtx);
      const mortgageRatesPromise = ask(pdMortgageRates, {}, { ...brokerCtx, cacheOnly: true });
      const taxCountry = countryForPostcode(property.postcode);
      // Stamp duty on a known asking price can start now; on an estimated
      // value it waits for the valuation.
      const stampDutyPromise = !input.rentPcm && input.askingPrice ? ask(pdStampDuty, { value: input.askingPrice, country: taxCountry, mode: 'investment' }, brokerCtx) : null;
      // EPC, flood, designations, listed buildings and exit liquidity: nine
      // cached one-credit questions, needed before the risk score.
      const dueDiligencePromise = dueDiligenceFor(property.postcode, property.address, brokerCtx);
      // The outcode's historic price growth, from the region key stats the
      // market-warm cron buys monthly; a report only reads the cache.
      const growthPromise = (async () => {
        const outcode = outcodeOf(property.postcode);
        const region = pdRegionForOutcode(outcode);
        if (!outcode || !region) return null;
        const r = await ask(pdRegionKeyStats, { region }, { ...brokerCtx, cacheOnly: true });
        const row = r.value ? keyStatsForOutcode(r.value, outcode) : null;
        return row ? outcodeGrowth(row, region, r.updatedAt) : null;
      })();

      const floorArea = await floorAreaPromise;

      const longLetPromise = longLetFor(
        property.postcode,
        property.bedrooms,
        {
          propertyType: input.propertyType,
          constructionDate: floorArea.constructionDate,
          internalArea: floorArea.squareFeet,
          ...(input.bathrooms && { bathrooms: input.bathrooms }),
          finishQuality: FINISH_QUALITY,
          outdoorSpace: input.outdoorSpace,
          offStreetParking: input.parkingSpaces,
        },
        brokerCtx,
      );

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
      const saleValuationPromise = saleValuationFor(property.postcode, property.bedrooms, input.propertyType, brokerCtx);

      // ── Listing-link extras, in parallel with the main calls ──
      // Tracked competitors within 1 km (one 5p bounds call per cell per
      // week) and, when an Airbnb was pasted, that listing's own figures.
      // The PMI second opinion is 50 credits, so it only runs in a full
      // report and only within its daily budget.
      const source = input.sourceListing;
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

      // The second opinion is the thing an ENHANCED report is bought for, so
      // a failure is reported rather than swallowed. It still never fails the
      // run: the rest of the report is unaffected, and the customer is told
      // on the report itself instead of quietly receiving a standard one.
      //
      // The notice rides on the promise's value rather than a `let` captured
      // by the callbacks. TypeScript narrows such a variable to `null` at the
      // point it is read back, so the field's type would claim "always null"
      // while the runtime value was a notice — compiling fine and lying.
      type SecondOpinionValue = NonNullable<AnalysisResult['secondOpinion']>;
      const secondOpinionPromise: Promise<{ value: SecondOpinionValue | null; notice: EnhancedNotice | null }> =
        (async () => {
          if (!wantEnhanced) return { value: null, notice: null };
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
          if (r.value) {
            return { value: { ...r.value, provider: 'pmi' as const, updatedAt: r.updatedAt }, notice: null };
          }
          // PMI answered with nothing usable — no error to classify, but the
          // customer is just as short of the feature they paid for.
          return { value: null, notice: noticeForEmptyResult() };
        })().catch((err) => {
          console.error('[analyse] second opinion failed:', err);
          return { value: null, notice: noticeForFailure(err) };
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

      progress('diligence', 85, 'Checking flood risk, EPC and planning designations...');
      const { epc, dueDiligence } = await dueDiligencePromise;

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
      const risk = assessRisk(shortLet, longLet, demandDrivers, nearbyEvents, { floodRisk: dueDiligence?.floodRisk?.level ?? null });
      const verdict = generateVerdict(financials, risk);

      const now = new Date().toISOString();

      // ── Deal maths on the asking price / advertised rent (or the estimate) ──
      const [competitors, secondOpinionOutcome, councilTaxRes, mortgageRatesRes] = await Promise.all([competitorsPromise, secondOpinionPromise, councilTaxPromise, mortgageRatesPromise]);
      const secondOpinion = secondOpinionOutcome.value;

      // A member's saved goal profile wins; otherwise the higher of the
      // national 2- and 3-year fixed averages, and only then the old 5.5%.
      const live = liveMortgageRate(mortgageRatesRes.value);
      const finance: FinanceGoals = opts.finance ?? { ...DEFAULT_FINANCE_GOALS, ...(live ? { mortgageRatePct: live.ratePct } : {}) };
      const mortgageRate: MortgageRateInfo = { source: opts.finance ? 'profile' : live ? 'live' : 'default', live };

      // Council tax from the property's own band replaces the council-tax
      // share of the old flat £250 bills line.
      const councilTax = pickCouncilTaxBand(councilTaxRes.value, property.address);
      const bills = { ...billsFromCouncilTax(councilTax), councilTax };

      // Stamp duty from PropertyData's calculator for the price the deal is
      // on; the local bands are the fallback inside purchaseDeal.
      const purchasePrice = input.rentPcm ? null : (input.askingPrice ?? propertyValuation?.estimatedValue ?? null);
      let stampDuty: StampDutyFigure | undefined;
      if (purchasePrice) {
        const sd = await (stampDutyPromise ?? ask(pdStampDuty, { value: purchasePrice, country: taxCountry, mode: 'investment' }, brokerCtx));
        stampDuty = sd.value ? stampDutyFromApi(sd.value, taxCountry, purchasePrice) : undefined;
      }

      // Where the value might go: the outcode's past five years projected
      // forward as a range. Informational only; nothing else reads it.
      const growth = await growthPromise;
      const valueBase = input.askingPrice ?? propertyValuation?.estimatedValue ?? null;
      const futureValue = growth && valueBase ? futureValueRange(valueBase, input.askingPrice ? 'asking-price' : 'estimated-value', growth.growth5y, growth.outcode, growth.asOf) : null;

      const dealBase = { grossRevenue: shortLet.annualRevenue, adr: shortLet.averageDailyRate, bedrooms: property.bedrooms, finance, country: taxCountry, stampDuty, mortgageRate, bills };
      let deal: DealResult | null = null;
      if (input.rentPcm) deal = { ...rentToRentDeal(input.rentPcm, dealBase), basis: 'advertised-rent' };
      else if (input.askingPrice) deal = { ...purchaseDeal(input.askingPrice, dealBase), basis: 'asking-price' };
      else if (propertyValuation?.estimatedValue) deal = { ...purchaseDeal(propertyValuation.estimatedValue, dealBase), basis: 'estimated-value' };
      const fixedPcm = deal?.kind === 'rent-to-rent' ? deal.advertisedRentPcm : deal?.kind === 'purchase' ? deal.mortgageMonthly : 0;
      const cashflow = shortLet.annualRevenue > 0 ? monthlyCashflow(shortLet.monthlyRevenue, fixedPcm, { billsPcm: bills.billsPcm }) : null;

      const result: AnalysisResult = {
        // The geocoder knows the town; the form only ever had a postcode.
        property: coordinates.locality
          ? { ...property, locality: coordinates.locality }
          : property,
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
        councilTax,
        epc,
        dueDiligence,
        growth,
        futureValue,
        sourceListing: source,
        deal,
        cashflow,
        competitors,
        secondOpinion,
        // Present only when an enhanced run came back without one.
        enhancedNotice: secondOpinionOutcome.notice,
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
