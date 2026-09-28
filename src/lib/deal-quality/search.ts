import 'server-only';

/**
 * A deal check's comparables search and income, server side: the radius
 * steps through the broker (every Airbtics call budgeted, cached for a week
 * and logged in provider_calls under `dealComparables`), then the analyser's
 * pipeline on what came back. Shared by the daily checks and the Step 0
 * comparison with past reports.
 */
import { ask, dealComparables } from '../broker';
import { classifyLocation, dealIncomeFromComps, type ShortLetOptions } from '../apis/airbtics';
import type { DataQuality, ShortLetData } from '../types';
import type { DealCompsSettings, DealConfidenceSettings } from './config';
import {
  bedroomsOf,
  confidenceFor,
  isEntireHome,
  nextSearchStep,
  PAGE_SIZE,
  POOL_LIMIT,
  revenueSpread,
  settingFilter,
  similarComps,
  startRadiusKm,
  toReportComp,
  type CompListing,
  type DealConfidence,
  type SearchStep,
  type SimilarComp,
  type StepResult,
  type Subject,
} from './comps';

/** Never more search steps than this, cached or not. */
const MAX_STEPS = 8;

export interface CompsSearch {
  /** Similar comparables within the final radius, nearest first, at most POOL_LIMIT. */
  comps: SimilarComp[];
  radiusKm: number;
  steps: StepResult[];
  /** Airbtics calls actually made; cached answers are free and not counted. */
  calls: number;
  /** What those calls cost, raw pence, as the broker priced them. */
  pence: number;
  /** The flat/house test left too few, so every kind was used. */
  kindRelaxed: boolean;
  /** Share of the returned listings that meet the filters Airbtics was asked for; null when none came back. */
  filterMatch: number | null;
  /** Whether Airbtics took the filters on every page (false: the plain-box fallback ran). */
  filtered: boolean;
  /** Every listing in the final box was read. */
  everyListingRead: boolean;
  /** A search failed: the provider is down, refused, or out of today's budget. */
  failed: boolean;
  /** The caller's ceiling stopped the search before it was done. */
  stopped: boolean;
}

export interface SearchOptions {
  /** How far the nearest past report's comparables reached, km, when known. */
  hintKm: number | null;
  /** The most Airbtics calls this search may make. */
  maxCalls: number;
  /**
   * Claims one call against a shared ceiling before each search; false stops
   * the search. `release` gives the claim back when the answer came from the
   * cache (no call was made).
   */
  claim?: () => boolean;
  release?: () => void;
}

export async function searchDealComps(subject: Subject & { postcode: string }, settings: DealCompsSettings, opts: SearchOptions): Promise<CompsSearch> {
  const out: CompsSearch = { comps: [], radiusKm: 0, steps: [], calls: 0, pence: 0, kindRelaxed: false, filterMatch: null, filtered: true, everyListingRead: false, failed: false, stopped: false };
  const listings: CompListing[] = [];
  let step: SearchStep | null = { radiusKm: startRadiusKm(settings, opts.hintKm, classifyLocation(subject.postcode)), page: 1 };
  let found = 0;
  while (step && out.steps.length < MAX_STEPS) {
    if (out.calls >= opts.maxCalls) break;
    if (opts.claim && !opts.claim()) {
      out.stopped = true;
      break;
    }
    const res = await ask(dealComparables, { lat: subject.lat, lng: subject.lng, radiusKm: step.radiusKm, bedrooms: subject.bedrooms, page: step.page }, { mode: 'cron', userId: null });
    if (res.cached) opts.release?.();
    else if (res.provider) {
      out.calls += 1;
      out.pence += res.costPence;
    }
    const page = res.value;
    if (!page) {
      // Nothing answered: no call was billed (a failed call is logged at 0p).
      if (!res.cached && !res.provider) opts.release?.();
      out.failed = true;
      break;
    }
    if (!page.filtered) out.filtered = false;
    listings.push(...page.listings);
    out.steps.push({ ...step, returned: page.listings.length, totalCount: page.totalCount });
    found = similarComps(listings, subject, step.radiusKm).matched.length;
    step = nextSearchStep(settings, out.steps, found, opts.maxCalls - out.calls);
  }
  const last = out.steps[out.steps.length - 1];
  if (!last) return out;
  out.radiusKm = last.radiusKm;
  out.everyListingRead = last.page * PAGE_SIZE >= last.totalCount;
  const similar = similarComps(listings, subject, last.radiusKm);
  const useAny = similar.matched.length < settings.minComps && similar.anyKind.length >= settings.minComps;
  out.kindRelaxed = useAny;
  out.comps = (useAny ? similar.anyKind : similar.matched).slice(0, POOL_LIMIT);
  const wanted = (l: CompListing) => {
    const beds = bedroomsOf(l.bedrooms);
    const bedsOk = subject.bedrooms >= 6 ? beds !== null && beds >= 6 : subject.bedrooms === 0 || beds === subject.bedrooms;
    return bedsOk && isEntireHome(l) && (l.annual_revenue_ltm ?? 0) > 0;
  };
  out.filterMatch = listings.length > 0 ? Math.round((listings.filter(wanted).length / listings.length) * 100) / 100 : null;
  return out;
}

export interface IncomeVariant {
  /** Keep Airbtics' listing dates, so the pipeline annualises young listings (a full report carries none). */
  keepListingDate: boolean;
  /** No monthly history: keep ADR flat; the UK curve shapes occupancy only. */
  flatAdrWithoutMonthly: boolean;
}

/** The planned deal check: as a full report reads its comparables, with the seasonal fix. */
export const DEAL_CHECK_VARIANT: IncomeVariant = { keepListingDate: false, flatAdrWithoutMonthly: true };

export interface CheckedFigures {
  gross: number;
  adr: number;
  /** 0–1. */
  occupancy: number;
  /** The comparables the pipeline kept (its top 12 after its own filters). */
  compCount: number;
  spreadPct: number | null;
  confidence: DealConfidence;
  locationClass: string | null;
  data: ShortLetData;
  quality: DataQuality;
}

export interface IncomeSubject extends Subject {
  guests: number;
  postcode: string;
  options?: ShortLetOptions;
}

/**
 * The deal's figures from its comparables through the analyser's pipeline,
 * and how far the comparables it kept agree. Null under the minimum.
 */
export function incomeFromComps(comps: readonly SimilarComp[], subject: IncomeSubject, radiusKm: number, variant: IncomeVariant, conf: DealConfidenceSettings, minComps: number): CheckedFigures | null {
  if (comps.length < minComps) return null;
  const { data, quality } = dealIncomeFromComps(
    comps.map((c) => toReportComp(c, variant.keepListingDate)),
    { lat: subject.lat, lng: subject.lng, bedrooms: subject.bedrooms, guests: subject.guests, postcode: subject.postcode, radiusKm, options: subject.options },
    { flatAdrWithoutMonthly: variant.flatAdrWithoutMonthly },
  );
  const kept = data.comparables ?? [];
  if (kept.length < minComps || !(data.annualRevenue > 0)) return null;
  const spread = revenueSpread(kept.map((c) => c.annualRevenue));
  return {
    gross: Math.round(data.annualRevenue),
    adr: Math.round(data.averageDailyRate),
    occupancy: data.occupancyRate,
    compCount: kept.length,
    spreadPct: spread?.spreadPct ?? null,
    confidence: confidenceFor(spread, kept.length, conf, minComps),
    locationClass: data.locationClass ?? null,
    data,
    quality,
  };
}

/** The setting check applied to a search's comparables (see comps.ts settingFilter). */
export function withSettingFilter(search: CompsSearch, subject: Pick<Subject, 'lat' | 'lng'>, settings: DealCompsSettings) {
  return settingFilter(search.comps, subject, search.radiusKm, search.everyListingRead, settings.setting, settings.minComps);
}
