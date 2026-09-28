import 'server-only';

/**
 * The marketplace sweep: every top scored area, both kinds, through the same
 * broker path the daily picks use, screened into the pool.
 *
 * Runs as several short cron passes (the route is capped at 60 s and PMI
 * paces listings calls ~5 s apart). Each pass records the searches it
 * finished in its marketplace_runs summary, and later passes skip them
 * without asking the broker, so the day's passes share the list instead of
 * re-reading the same answers (src/lib/marketplace/sweep-plan.ts has the
 * order). A listing seen in today's feed is confirmed live for free; one the
 * feed marks sold or let agreed is retired for free; a qualified newcomer is
 * inserted as pending_verify and the hourly recheck reads its page before it
 * goes live.
 *
 * Entry points: /api/internal/marketplace-sweep (cron, secret-gated) and the
 * /admin/deals buttons (session-gated). MARKETPLACE_SWEEP_ENABLED=false is
 * the kill switch for the cron.
 */
import { createAdminClient } from '../supabase/admin';
import { ask, marketplaceListings } from '../broker';
import { runMetered, newActionId } from '../credit/context';
import { pmiAccount, pmiConfigured } from '../broker/providers/pmi';
import { COST_PENCE } from '../broker/config';
import { absorbListings, cohortLoader, emptyAbsorbCounters, type AbsorbCounters } from './absorb';
import { loadScreenContext, recordRun, revalidateDeals, DEAL_COLUMNS, type Admin } from './server';
import { countFrom, DEFAULT_SWEEP_MAX_QUERIES, HISTORY_DAYS, planPass, sweepAreaLimit, sweepEnabled, sweepHistory, sweepQueries, type SweepHistory, type SweepRunRecord } from './sweep-plan';
import { sweepDemandScores } from '../sourcing-demand/server';

const TIME_BUDGET_MS = 50_000;
const SNAPSHOT_WAIT_MS = 20_000;
const QUERY_BUDGET_MS = 44_000;
const COHORT_AREAS_PER_PASS = 4;

// The kill switch and the area limit live in sweep-plan.ts, so the demand-led
// searches can read them without importing this file.
export { sweepAreaLimit, sweepEnabled };

export interface SweepOptions {
  dry: boolean;
  maxQueries?: number;
  areas?: number;
}

export interface SweepSummary extends AbsorbCounters {
  dry: boolean;
  enabled: boolean;
  areas: number;
  queries: number;
  answered: number;
  cached: number;
  unavailable: number;
  listings: number;
  /** Searches left to ask for when the pass started (the list minus what is done). */
  pending: number;
  /** Finished by an earlier pass today: skipped without asking the broker. */
  doneToday: number;
  /** Came back empty twice today: left until tomorrow. */
  leftForTomorrow: number;
  /** Of the searches left, how many are in areas members want (they go first). */
  wanted: number;
  /** The searches this pass finished, and the ones that came back empty (read by later passes). */
  doneKeys: string[];
  emptyKeys: string[];
  cohortAreas: number;
  rawCostPence: number;
  ranOutOfTime: boolean;
  ms?: number;
  [k: string]: unknown;
}

export interface SweepResult {
  status: number;
  body: SweepSummary | { error: string; detail?: string };
}

/** Earlier sweep passes over the last few days: what each finished and found empty. */
async function loadHistory(admin: Admin, now: Date): Promise<SweepHistory> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('marketplace_runs')
    .select('started_at, doneKeys:summary->doneKeys, emptyKeys:summary->emptyKeys')
    .eq('kind', 'sweep')
    .eq('dry', false)
    .gte('started_at', since);
  if (error) {
    // Unreadable: plan as if nothing were done, which is how every pass behaved before.
    console.warn('[marketplace-sweep] run history unreadable:', error.message);
    return sweepHistory([], now);
  }
  const runs: SweepRunRecord[] = ((data ?? []) as { started_at: string; doneKeys: unknown; emptyKeys: unknown }[]).map((r) => ({ startedAt: r.started_at, doneKeys: r.doneKeys, emptyKeys: r.emptyKeys }));
  return sweepHistory(runs, now);
}

export async function runSweep(opts: SweepOptions): Promise<SweepResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: SweepResult): SweepResult => {
    const body = result.body as Record<string, unknown>;
    const { wouldQuery: _w, doneKeys: _d, emptyKeys: _e, ...rest } = body;
    void _w;
    void _d;
    void _e;
    console.log('[marketplace-sweep] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return done({ status: 503, body: { error: 'snapshot_warming', detail: 'Market snapshot still building; the next pass will use it' } });
  const areas = opts.areas ?? sweepAreaLimit();
  const maxQueries = opts.maxQueries ?? countFrom(process.env.MARKETPLACE_SWEEP_MAX_QUERIES, DEFAULT_SWEEP_MAX_QUERIES);
  const queries = sweepQueries(ctx.cards, areas, maxQueries);
  // Members' wanted areas go first (Batch 15); no demand, or any failure reading it, keeps the score order.
  const [history, demandScore] = await Promise.all([loadHistory(admin, startedAt), sweepDemandScores(startedAt)]);
  const plan = planPass(queries, history, demandScore);

  const summary: SweepSummary = {
    dry: opts.dry,
    enabled: sweepEnabled(),
    areas: new Set(queries.map((q) => q.area)).size,
    queries: queries.length,
    answered: 0,
    cached: 0,
    unavailable: 0,
    listings: 0,
    pending: plan.pending.length,
    doneToday: plan.doneToday,
    leftForTomorrow: plan.leftForTomorrow,
    wanted: plan.pending.filter((q) => (demandScore.get(q.area.toUpperCase()) ?? 0) > 0).length,
    doneKeys: [],
    emptyKeys: [],
    ...emptyAbsorbCounters(),
    cohortAreas: 0,
    rawCostPence: 0,
    ranOutOfTime: false,
  };

  if (opts.dry) {
    const account = pmiConfigured() ? await pmiAccount().catch(() => null) : null;
    return done({
      status: 200,
      body: {
        ...summary,
        // Worst case: every search still to do today answered by PMI. Finished searches cost nothing more.
        estimatedRawPence: plan.pending.length * COST_PENCE.pmiListings,
        pmi: account ? { plan: account.plan ?? null, creditsMonthly: account.credits_monthly ?? null, creditsRemaining: account.credits_remaining ?? null } : null,
        wouldQuery: plan.pending.map((q) => q.key),
      },
    });
  }

  // The cohort feed for an area, from the weekly cache or a fresh (paid) read.
  const cohorts = cohortLoader(admin, { buy: true, maxBuys: COHORT_AREAS_PER_PASS, action: 'cron:marketplace-sweep', tag: 'marketplace-sweep' });

  for (const query of plan.pending) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const res = await runMetered({ userId: null, admin: false, action: 'cron:marketplace-sweep', actionId: newActionId() }, () => ask(marketplaceListings, query, { mode: 'cron' }));
    if (!res.value) {
      summary.unavailable += 1;
      summary.emptyKeys.push(query.key);
      continue;
    }
    summary.answered += 1;
    if (res.cached) summary.cached += 1;
    summary.rawCostPence += res.costPence ?? 0;
    const listings = res.value;
    summary.listings += listings.length;
    if (listings.length > 0) {
      await cohorts.loadFor(query.area);
      summary.cohortAreas = cohorts.bought();
      await absorbListings(admin, ctx.cardByCode, ctx.rentTable, cohorts.index, query, listings, summary);
    }
    summary.doneKeys.push(query.key);
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
  }

  summary.ms = elapsed();
  await recordRun(admin, 'sweep', false, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}

export { DEAL_COLUMNS };
