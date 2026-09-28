import 'server-only';

/**
 * The demand-led searches: areas members' running profiles want that the
 * marketplace sweep does not cover, searched within a monthly provider-spend
 * cap and folded into the pool exactly as the sweep folds its own (the shared
 * src/lib/marketplace/absorb.ts). New deals arrive as pending_verify; the
 * hourly recheck reads their page, and the free-member delay starts when they
 * go live, as for any deal.
 *
 * Each search claims its worst-case cost against the cap first
 * (demand_search_reserve, which also refuses an area × kind already searched
 * today), asks the broker as house spend under its own action id, and is
 * then settled to what the meter recorded for that id. A pass stops at the
 * cap, after two searches in a row come back with nothing, at eight searches
 * or when its time is up. It never buys PropertyData cohorts: it reads the
 * sweep's weekly cache.
 *
 * Entry points: /api/internal/demand-sourcing (cron, secret-gated; off until
 * DEMAND_SOURCING_ENABLED=true) and /admin/demand ("Run a pass now" and the
 * live plan, admin-gated).
 */
import { createAdminClient } from '../supabase/admin';
import { ask, marketplaceListings } from '../broker';
import { COST_PENCE } from '../broker/config';
import { runMetered, newActionId } from '../credit/context';
import { getUnitCostTable } from '../credit/unit-costs';
import { unitKey } from '../credit/costs';
import { areaMetaForCode } from '../market/areas';
import { londonDay, londonMonthStart } from '../sms/uk-time';
import type { SourcingQuery } from '../listing/sourcing';
import { absorbListings, cohortLoader, emptyAbsorbCounters, type AbsorbCounters } from '../marketplace/absorb';
import { loadScreenContext, revalidateDeals } from '../marketplace/server';
import { DEMAND_ACTION, MAX_FAILURES_IN_A_ROW, MAX_SEARCHES_PER_PASS, PASS_BUDGET_MS, SNAPSHOT_WAIT_MS, STALE_CLAIM_MS } from './config';
import { actualPence, effectiveCap, reservePence, type UnitCostOf } from './cost';
import { cellKey, planSearches } from './demand';
import { planView } from './table';
import type { DemandSettings } from './settings';
import { areaDataFrom, cachedAnswerKeys, callRowsFor, claimSearch, closeStaleClaims, livePool, loadDemand, monthFigures, readDemandSettings, searchedTodayKeys, settleSearch, sweepAreaSet, type Admin } from './server';

/** The cron's switch: off unless DEMAND_SOURCING_ENABLED is 'true', like the text alerts. */
export function demandSourcingEnabled(): boolean {
  return process.env.DEMAND_SOURCING_ENABLED === 'true';
}

export interface DemandRunOptions {
  dry: boolean;
  /** Searches this pass (default 8). */
  maxQueries?: number;
  /** Lower the monthly cap for this run only (testing). Never raises it. */
  capPence?: number | null;
  /** cron, internal, or the admin's email. */
  triggeredBy?: string;
}

export type StopReason = 'cap' | 'failures' | 'time' | 'max' | 'error' | null;

export interface DemandRunSummary extends AbsorbCounters {
  dry: boolean;
  enabled: boolean;
  month: string;
  day: string;
  settings: DemandSettings;
  capPence: number;
  spentPence: number | null;
  remainingPence: number | null;
  /** False until the Batch 15 section of supabase/schema.sql has been run: nothing is searched. */
  schemaReady: boolean;
  members: number;
  profiles: number;
  profilesWithoutAreas: number;
  leftOut: { staff: number; inactive: number };
  /** Area × kind cells any profile wants, and how many the plan takes on today. */
  wanted: number;
  planned: number;
  searched: number;
  answered: number;
  unavailable: number;
  cached: number;
  failed: number;
  duplicates: number;
  listings: number;
  costPence: number;
  closedStale: number;
  stopped: StopReason;
  ms?: number;
  [k: string]: unknown;
}

export interface DemandRunResult {
  status: number;
  body: DemandRunSummary | { error: string; detail?: string };
}

async function unitCostLookup(): Promise<UnitCostOf> {
  const table = await getUnitCostTable();
  return (provider, unit) => table.get(unitKey(provider, unit))?.unitCostPence ?? null;
}

export async function runDemandSourcing(opts: DemandRunOptions): Promise<DemandRunResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: DemandRunResult): DemandRunResult => {
    const { wouldSearch: _w, skipped: _s, settings: _c, ...rest } = result.body as Record<string, unknown>;
    void _w;
    void _s;
    void _c;
    console.log('[demand-sourcing] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const settings = await readDemandSettings(admin);
  const capPence = effectiveCap(settings.capPence, opts.capPence);
  const maxQueries = opts.maxQueries && opts.maxQueries > 0 ? Math.floor(opts.maxQueries) : MAX_SEARCHES_PER_PASS;
  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return done({ status: 503, body: { error: 'snapshot_warming', detail: 'Market snapshot still building; the next pass will use it' } });
  const demand = await loadDemand(admin, settings, startedAt);
  if (demand === null) return done({ status: 503, body: { error: 'members_unreadable' } });

  const month = londonMonthStart(startedAt);
  const day = londonDay(startedAt);
  const [figures, searchedToday, pool, unitCostOf] = await Promise.all([monthFigures(admin, month), searchedTodayKeys(admin, day), livePool(admin), unitCostLookup()]);
  const schemaReady = figures !== null && searchedToday !== null;
  const liveDeals = new Map<string, number>();
  for (const r of pool ?? []) {
    if (!r.postcode_area || (r.kind !== 'sale' && r.kind !== 'rent')) continue;
    const k = cellKey(r.postcode_area.toUpperCase(), r.kind);
    liveDeals.set(k, (liveDeals.get(k) ?? 0) + 1);
  }
  const plan = planSearches(demand, { minMembers: settings.minMembers, payingWeight: settings.payingWeight, sweepAreas: sweepAreaSet(ctx.cards), areaData: areaDataFrom(ctx.cards), searchedToday: searchedToday ?? new Set(), liveDeals });
  const reserve = reservePence(unitCostOf, COST_PENCE.pmiListings);

  const summary: DemandRunSummary = {
    dry: opts.dry,
    enabled: demandSourcingEnabled(),
    month,
    day,
    settings,
    capPence,
    spentPence: figures?.spentPence ?? null,
    remainingPence: figures ? Math.max(0, capPence - figures.spentPence) : null,
    schemaReady,
    members: demand.summary.members,
    profiles: demand.summary.profiles,
    profilesWithoutAreas: demand.summary.profilesWithoutAreas,
    leftOut: demand.summary.leftOut,
    wanted: demand.cells.size,
    planned: plan.searches.length,
    searched: 0,
    answered: 0,
    unavailable: 0,
    cached: 0,
    failed: 0,
    duplicates: 0,
    listings: 0,
    costPence: 0,
    closedStale: 0,
    stopped: null,
    ...emptyAbsorbCounters(),
  };

  if (opts.dry) {
    const view = planView(plan, reserve, await cachedAnswerKeys(admin, startedAt), maxQueries);
    const estimatedPence = view.wouldSearch.filter((s) => s.thisPass).reduce((a, s) => a + s.estPence, 0);
    return done({ status: 200, body: { ...summary, reservePence: reserve, estimatedPence: Math.round(estimatedPence * 10_000) / 10_000, ...view } });
  }
  if (!schemaReady) return done({ status: 503, body: { error: 'demand_schema_missing', detail: 'Run the "Batch 15: demand-led sourcing" section of supabase/schema.sql; nothing is searched until then' } });

  summary.closedStale = await closeStaleClaims(admin, STALE_CLAIM_MS, startedAt);
  const runId = newActionId();
  const triggeredBy = opts.triggeredBy || 'cron';
  const cohorts = cohortLoader(admin, { buy: false, maxBuys: 0, action: DEMAND_ACTION, tag: 'demand-sourcing' });
  let failuresInARow = 0;

  for (const s of plan.searches) {
    if (summary.searched >= maxQueries) {
      summary.stopped = 'max';
      break;
    }
    if (elapsed() > PASS_BUDGET_MS) {
      summary.stopped = 'time';
      break;
    }
    const actionId = newActionId();
    const claim = await claimSearch(admin, { month, day, area: s.area, kind: s.kind, key: s.key, reservePence: reserve, capPence, actionId, runId, triggeredBy, members: s.members, payingMembers: s.paying });
    if (claim.refused === 'duplicate') {
      summary.duplicates += 1;
      continue;
    }
    if (claim.refused) {
      summary.stopped = claim.refused;
      break;
    }
    summary.searched += 1;
    const meta = areaMetaForCode(s.area);
    const query: SourcingQuery = { key: s.key, kind: s.kind, area: s.area, areaName: meta.name, areaSlug: meta.slug, minPrice: null, maxPrice: null, minBedrooms: null };
    const settle = { status: 'failed' as 'answered' | 'unavailable' | 'failed', provider: null as string | null, cached: null as boolean | null, listings: null as number | null, newDeals: null as number | null };
    try {
      const res = await runMetered({ userId: null, admin: false, action: DEMAND_ACTION, actionId }, () => ask(marketplaceListings, query, { mode: 'cron' }));
      settle.provider = res.provider;
      settle.cached = res.cached;
      if (!res.value) {
        settle.status = 'unavailable';
        summary.unavailable += 1;
        failuresInARow += 1;
      } else {
        settle.status = 'answered';
        summary.answered += 1;
        if (res.cached) summary.cached += 1;
        failuresInARow = 0;
        settle.listings = res.value.length;
        summary.listings += res.value.length;
        const before = summary.newDeals;
        if (res.value.length > 0) {
          await cohorts.loadFor(s.area);
          await absorbListings(admin, ctx.cardByCode, ctx.rentTable, cohorts.index, query, res.value, summary, 'demand-sourcing');
        }
        settle.newDeals = summary.newDeals - before;
      }
    } catch (err) {
      console.error('[demand-sourcing] search failed:', s.key, (err as Error)?.message ?? err);
      summary.failed += 1;
      failuresInARow += 1;
    } finally {
      // Whatever happened, the claim is settled: to the metered cost, or to its reserve when the calls cannot be read.
      const calls = await callRowsFor(admin, actionId);
      const cost = calls === null ? reserve : actualPence(calls, unitCostOf);
      summary.costPence = Math.round((summary.costPence + cost) * 10_000) / 10_000;
      await settleSearch(admin, claim.id, { ...settle, costPence: cost });
    }
    if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
      summary.stopped = 'failures';
      break;
    }
  }

  const after = await monthFigures(admin, month);
  if (after) {
    summary.spentPence = after.spentPence;
    summary.remainingPence = Math.max(0, capPence - after.spentPence);
  }
  summary.ms = elapsed();
  // New, repriced, revived or retired rows all change what /deals shows.
  if (summary.searched > 0) revalidateDeals();
  return done({ status: 200, body: summary });
}
