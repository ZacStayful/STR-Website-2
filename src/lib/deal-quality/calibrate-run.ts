import 'server-only';

/**
 * Step 0: the deal check's comparables search re-run on past full analyses
 * (see calibration.ts). Entry points: the /admin/demand buttons and
 * /api/internal/deal-comps-calibrate (secret-gated, ?dry=1).
 *
 * A run works through the cases not yet done inside ~45 seconds, three at a
 * time, and records what it did in marketplace_runs (kind
 * 'deal_calibration', with who ran it). Pressing Run again carries on.
 * Every Airbtics call is claimed against CALIBRATION_MAX_CALLS for the whole
 * comparison before it is made, so the comparison can never spend more than
 * £3.60, however often it is run. House spend: nothing is charged to anyone.
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { providerEnabled, COST_PENCE } from '../broker/config';
import {
  CALIBRATION_CLASSES,
  CALIBRATION_KIND,
  CALIBRATION_MAX_CALLS,
  CALIBRATION_WINDOW_DAYS,
  chooseCases,
  gapPct,
  latestResults,
  optionsFromMultipliers,
  summariseCalibration,
  type CaseResult,
  type VariantResult,
} from './calibration';
import { revenueSpread, type SimilarComp } from './comps';
import { DEAL_CHECK_VARIANT, incomeFromComps, searchDealComps, withSettingFilter, type IncomeVariant } from './search';
import { readDealQualitySettings, type DealQualitySettings } from './settings-server';

type Admin = ReturnType<typeof createAdminClient>;

const TIME_BUDGET_MS = 45_000;
const WORKERS = 3;
/** Calls a case is expected to take, for the dry run's estimate. */
const EXPECTED_CALLS_PER_CASE = 1.3;

interface CaseRow {
  id: string;
  created_at: string;
  postcode: string | null;
  postcode_area: string | null;
  bedrooms: number | null;
  gross_revenue: number | string | null;
  comp_count: number | null;
  comp_radius_km: number | string | null;
  lat: number | string | null;
  lng: number | string | null;
  location_class: string | null;
  guests: string | null;
  quality: string | null;
}

interface Case {
  id: string;
  area: string;
  postcode: string;
  locationClass: string;
  bedrooms: number;
  guests: number;
  lat: number;
  lng: number;
  storedGross: number;
  storedCompCount: number | null;
  storedRadiusKm: number | null;
  storedSpreadPct: number | null;
  options: { outdoorSpace?: string; parkingSpaces?: number };
}

interface RunSummary {
  triggeredBy?: string;
  caseIds?: string[];
  results?: CaseResult[];
  calls?: number;
  pence?: number;
}

export interface CalibrationRunResult {
  status: number;
  body: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The reports the comparison may use: analyser runs with a location, guests and high-quality data, 1–5 beds. */
async function candidates(admin: Admin): Promise<CaseRow[] | null> {
  const { data, error } = await admin
    .from('analyser_reports')
    .select('id, created_at, postcode, postcode_area, bedrooms, gross_revenue, comp_count, comp_radius_km, lat, lng, location_class:raw_response->shortLet->>locationClass, guests:raw_response->property->>guests, quality:raw_response->dataQuality->>level')
    .eq('source', 'analyser')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .gte('bedrooms', 1)
    .lte('bedrooms', 5)
    .gt('gross_revenue', 0)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) {
    console.error('[deal-calibration] candidates unreadable:', error.message);
    return null;
  }
  const classes = new Set<string>(CALIBRATION_CLASSES);
  return ((data ?? []) as unknown as CaseRow[]).filter((r) => r.quality === 'high' && num(r.guests) !== null && r.location_class !== null && classes.has(r.location_class));
}

async function loadCases(admin: Admin, ids: string[]): Promise<Case[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from('analyser_reports')
    .select('id, created_at, postcode, postcode_area, bedrooms, gross_revenue, comp_count, comp_radius_km, lat, lng, location_class:raw_response->shortLet->>locationClass, guests:raw_response->property->>guests, multipliers:raw_response->shortLet->adrMultipliers, comparables:raw_response->shortLet->comparables')
    .in('id', ids);
  if (error) {
    console.error('[deal-calibration] cases unreadable:', error.message);
    return null;
  }
  const byId = new Map(((data ?? []) as unknown as (CaseRow & { multipliers: unknown; comparables: unknown })[]).map((r) => [r.id, r]));
  const out: Case[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    const lat = num(r?.lat);
    const lng = num(r?.lng);
    const gross = num(r?.gross_revenue);
    const guests = num(r?.guests);
    if (!r || lat === null || lng === null || gross === null || guests === null || r.bedrooms === null) continue;
    const comps = Array.isArray(r.comparables) ? (r.comparables as { annualRevenue?: unknown }[]) : [];
    const spread = revenueSpread(comps.map((c) => num(c.annualRevenue) ?? 0));
    out.push({
      id: r.id,
      area: r.postcode_area ?? '?',
      postcode: r.postcode ?? r.postcode_area ?? '',
      locationClass: r.location_class ?? 'unknown',
      bedrooms: r.bedrooms,
      guests: Math.round(guests),
      lat,
      lng,
      storedGross: gross,
      storedCompCount: r.comp_count,
      storedRadiusKm: num(r.comp_radius_km),
      storedSpreadPct: spread?.spreadPct ?? null,
      options: optionsFromMultipliers(r.multipliers as { outdoorSpace?: unknown; parking?: unknown } | null),
    });
  }
  return out;
}

interface Batch {
  caseIds: string[];
  results: Map<string, CaseResult>;
  calls: number;
  pence: number;
}

/** The comparison under way: the runs of the last fortnight. The first run's case list is the comparison's. */
async function loadBatch(admin: Admin, now: Date): Promise<Batch | null> {
  const since = new Date(now.getTime() - CALIBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('marketplace_runs').select('started_at, summary').eq('kind', CALIBRATION_KIND).eq('dry', false).gte('started_at', since).order('started_at', { ascending: true }).limit(200);
  if (error) {
    console.error('[deal-calibration] runs unreadable:', error.message);
    return null;
  }
  const runs = ((data ?? []) as { summary: RunSummary | null }[]).map((r) => r.summary ?? {});
  const withCases = runs.find((r) => Array.isArray(r.caseIds) && r.caseIds.length > 0);
  return {
    caseIds: withCases?.caseIds ?? [],
    results: latestResults(runs),
    calls: runs.reduce((s, r) => s + (num(r.calls) ?? 0), 0),
    pence: runs.reduce((s, r) => s + (num(r.pence) ?? 0), 0),
  };
}

async function runCase(c: Case, settings: DealQualitySettings, claim: () => boolean, release: () => void): Promise<CaseResult> {
  const subject = { lat: c.lat, lng: c.lng, bedrooms: c.bedrooms, kind: 'unknown' as const, postcode: c.postcode };
  const base: CaseResult = {
    id: c.id,
    area: c.area,
    locationClass: c.locationClass,
    bedrooms: c.bedrooms,
    guests: c.guests,
    storedGross: c.storedGross,
    storedCompCount: c.storedCompCount,
    storedRadiusKm: c.storedRadiusKm,
    storedSpreadPct: c.storedSpreadPct,
    found: 0,
    radiusKm: 0,
    calls: 0,
    pence: 0,
    filtered: true,
    filterMatch: null,
    kindRelaxed: false,
    settingDropped: 0,
    variants: {},
  };
  try {
    const search = await searchDealComps(subject, settings.comps, { hintKm: null, maxCalls: settings.checks.maxCallsPerCheck, claim, release });
    const result: CaseResult = { ...base, found: search.comps.length, radiusKm: search.radiusKm, calls: search.calls, pence: search.pence, filtered: search.filtered, filterMatch: search.filterMatch, kindRelaxed: search.kindRelaxed };
    if (search.steps.length === 0) return { ...result, error: search.stopped ? 'spend ceiling reached' : 'search failed' };
    const incomeSubject = { ...subject, guests: c.guests, options: c.options };
    const figure = (v: IncomeVariant, comps: readonly SimilarComp[] = search.comps): VariantResult => {
      const f = incomeFromComps(comps, incomeSubject, search.radiusKm, v, settings.confidence, settings.comps.minComps);
      return f
        ? { gross: f.gross, compCount: f.compCount, spreadPct: f.spreadPct, confidence: f.confidence, gapPct: gapPct(f.gross, c.storedGross) }
        : { gross: null, compCount: comps.length, spreadPct: null, confidence: 'insufficient', gapPct: null };
    };
    result.variants.planned = figure(DEAL_CHECK_VARIANT);
    result.variants.withDates = figure({ keepListingDate: true, flatAdrWithoutMonthly: true });
    result.variants.bothCurves = figure({ keepListingDate: false, flatAdrWithoutMonthly: false });
    const setting = withSettingFilter(search, subject, settings.comps);
    result.settingDropped = setting.dropped;
    result.variants.setting = setting.applied ? figure(DEAL_CHECK_VARIANT, setting.kept) : result.variants.planned;
    if (search.failed) result.error = 'a later search step failed';
    return result;
  } catch (err) {
    console.error(`[deal-calibration] case ${c.id} failed:`, err);
    return { ...base, error: (err as Error)?.message?.slice(0, 200) ?? 'failed' };
  }
}

async function record(admin: Admin, dry: boolean, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: CALIBRATION_KIND, dry, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[deal-calibration] run record failed:', error.message);
}

export async function runDealCalibration(opts: { dry: boolean; triggeredBy: string }): Promise<CalibrationRunResult> {
  const startedAt = new Date();
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const settings = await readDealQualitySettings(admin);
  const batch = await loadBatch(admin, startedAt);
  if (!batch) return { status: 500, body: { error: 'Could not read earlier runs' } };

  let caseIds = batch.caseIds;
  if (caseIds.length === 0) {
    const rows = await candidates(admin);
    if (!rows) return { status: 500, body: { error: 'Could not read the past reports' } };
    caseIds = chooseCases(rows.map((r) => ({ ...r, bedrooms: r.bedrooms, location_class: r.location_class }))).map((r) => r.id);
  }
  const cases = await loadCases(admin, caseIds);
  if (!cases) return { status: 500, body: { error: 'Could not read the chosen reports' } };
  const remaining = cases.filter((c) => {
    const r = batch.results.get(c.id);
    return !r || Boolean(r.error);
  });
  const callsLeft = Math.max(0, CALIBRATION_MAX_CALLS - batch.calls);
  const keyed = providerEnabled('airbtics');
  const plan = {
    cases: cases.length,
    done: cases.length - remaining.length,
    remaining: remaining.length,
    callsUsed: batch.calls,
    penceUsed: batch.pence,
    callsLeft,
    maxCostPence: Math.min(callsLeft, remaining.length * settings.checks.maxCallsPerCheck) * COST_PENCE.airbticsBounds,
    expectedCostPence: Math.round(Math.min(callsLeft, remaining.length * EXPECTED_CALLS_PER_CASE) * COST_PENCE.airbticsBounds),
    airbticsKey: keyed,
    triggeredBy: opts.triggeredBy,
  };

  if (opts.dry) {
    const body = { dry: true, ...plan, wouldRun: remaining.map((c) => ({ area: c.area, class: c.locationClass, beds: c.bedrooms, guests: c.guests })) };
    await record(admin, true, startedAt, { ...body, caseIds });
    return { status: 200, body };
  }
  if (!keyed) return { status: 503, body: { error: 'AIRBTICS_API_KEY is not set here, so nothing was searched.', ...plan } };
  if (remaining.length === 0) return { status: 200, body: { ...plan, note: 'Every case is done.', summary: summariseCalibration([...batch.results.values()], cases.length, batch.calls, batch.pence) } };
  if (callsLeft === 0) return { status: 200, body: { ...plan, note: 'The comparison has used all its calls.' } };

  let claimed = 0;
  const claim = () => {
    if (claimed >= callsLeft) return false;
    claimed += 1;
    return true;
  };
  const release = () => {
    claimed = Math.max(0, claimed - 1);
  };
  const queue = [...remaining];
  const fresh: CaseResult[] = [];
  let stoppedBy: 'time' | 'ceiling' | null = null;
  const deadline = startedAt.getTime() + TIME_BUDGET_MS;
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() > deadline) {
        stoppedBy = 'time';
        return;
      }
      if (claimed >= callsLeft) {
        stoppedBy = 'ceiling';
        return;
      }
      const c = queue.shift()!;
      fresh.push(await runCase(c, settings, claim, release));
    }
  };
  await runMetered({ userId: null, admin: false, action: 'admin:deal-calibration', actionId: newActionId() }, () => Promise.all(Array.from({ length: WORKERS }, worker)));

  const calls = fresh.reduce((s, r) => s + r.calls, 0);
  const pence = fresh.reduce((s, r) => s + r.pence, 0);
  await record(admin, false, startedAt, { triggeredBy: opts.triggeredBy, caseIds, results: fresh, calls, pence, stoppedBy });
  const all = latestResults([{ results: [...batch.results.values()] }, { results: fresh }]);
  const summary = summariseCalibration([...all.values()], cases.length, batch.calls + calls, batch.pence + pence);
  return { status: 200, body: { ...plan, ranNow: fresh.length, callsNow: calls, penceNow: pence, stoppedBy, left: remaining.length - fresh.filter((r) => !r.error).length, summary } };
}

export interface CalibrationView {
  cases: number;
  results: CaseResult[];
  summary: ReturnType<typeof summariseCalibration>;
  /** The latest dry run, when it is newer than the latest real run. */
  dry: (Record<string, unknown> & { at: string }) | null;
  lastRunAt: string | null;
}

/** What /admin/demand shows of the comparison under way. Null when the runs cannot be read. */
export async function calibrationView(admin: Admin, now: Date = new Date()): Promise<CalibrationView | null> {
  const since = new Date(now.getTime() - CALIBRATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('marketplace_runs').select('dry, started_at, summary').eq('kind', CALIBRATION_KIND).gte('started_at', since).order('started_at', { ascending: true }).limit(300);
  if (error) {
    console.error('[deal-calibration] runs unreadable:', error.message);
    return null;
  }
  const rows = (data ?? []) as { dry: boolean; started_at: string; summary: (RunSummary & Record<string, unknown>) | null }[];
  const real = rows.filter((r) => !r.dry).map((r) => ({ at: r.started_at, s: r.summary ?? {} }));
  const dryRows = rows.filter((r) => r.dry);
  const lastRunAt = real.length > 0 ? real[real.length - 1].at : null;
  const lastDry = dryRows[dryRows.length - 1];
  const withCases = real.find((r) => Array.isArray(r.s.caseIds) && r.s.caseIds.length > 0);
  const results = [...latestResults(real.map((r) => r.s)).values()];
  const calls = real.reduce((s, r) => s + (num(r.s.calls) ?? 0), 0);
  const pence = real.reduce((s, r) => s + (num(r.s.pence) ?? 0), 0);
  const cases = withCases?.s.caseIds?.length ?? (typeof lastDry?.summary?.cases === 'number' ? (lastDry.summary.cases as number) : 0);
  const dry = lastDry && (!lastRunAt || lastDry.started_at > lastRunAt) ? { ...(lastDry.summary ?? {}), at: lastDry.started_at } : null;
  if (dry) delete (dry as Record<string, unknown>).caseIds;
  return { cases, results, summary: summariseCalibration(results, cases, calls, pence), dry, lastRunAt };
}
