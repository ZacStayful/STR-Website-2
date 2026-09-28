import 'server-only';

/**
 * The marketplace sweep: every top scored area, both kinds, through the same
 * broker path the daily picks use, screened into the pool.
 *
 * Runs as several short cron passes (the route is capped at 60 s and PMI
 * paces listings calls ~5 s apart). Each pass asks the broker for every
 * query in order; answers already given today come back from the cache in
 * milliseconds, so later passes finish what earlier ones started. A listing
 * seen in today's feed is confirmed live for free; one the feed marks sold
 * or let agreed is retired for free; a qualified newcomer is inserted as
 * pending_verify and the hourly recheck reads its page before it goes live.
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
import { topScoredAreas, type HouseAreaCard } from '../listing/picks';
import { queryKey, type SourcingKind, type SourcingQuery } from '../listing/sourcing';
import { absorbListings, cohortLoader, emptyAbsorbCounters, type AbsorbCounters } from './absorb';
import { loadScreenContext, recordRun, revalidateDeals, DEAL_COLUMNS, type Admin } from './server';

const TIME_BUDGET_MS = 50_000;
const SNAPSHOT_WAIT_MS = 20_000;
const QUERY_BUDGET_MS = 44_000;
const COHORT_AREAS_PER_PASS = 4;

export function sweepEnabled(): boolean {
  return process.env.MARKETPLACE_SWEEP_ENABLED !== 'false';
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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

/** The searches for one pass: every top area × both kinds, unbounded. */
export function sweepQueries(cards: HouseAreaCard[], areas: number, maxQueries: number): SourcingQuery[] {
  const out: SourcingQuery[] = [];
  for (const a of topScoredAreas(cards, areas)) {
    for (const kind of ['sale', 'rent'] as SourcingKind[]) {
      out.push({ key: queryKey(kind, a.code, null, null, null), kind, area: a.code, areaName: a.name, areaSlug: a.slug, minPrice: null, maxPrice: null, minBedrooms: null });
    }
  }
  return out.slice(0, maxQueries);
}

export async function runSweep(opts: SweepOptions): Promise<SweepResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: SweepResult): SweepResult => {
    const body = result.body as Record<string, unknown>;
    const { wouldQuery: _w, ...rest } = body;
    void _w;
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
  const areas = opts.areas ?? envInt('MARKETPLACE_SWEEP_AREAS', 60);
  const maxQueries = opts.maxQueries ?? envInt('MARKETPLACE_SWEEP_MAX_QUERIES', 120);
  const queries = sweepQueries(ctx.cards, areas, maxQueries);

  const summary: SweepSummary = {
    dry: opts.dry,
    enabled: sweepEnabled(),
    areas: new Set(queries.map((q) => q.area)).size,
    queries: queries.length,
    answered: 0,
    cached: 0,
    unavailable: 0,
    listings: 0,
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
        estimatedRawPence: queries.length * COST_PENCE.pmiListings,
        pmi: account ? { plan: account.plan ?? null, creditsMonthly: account.credits_monthly ?? null, creditsRemaining: account.credits_remaining ?? null } : null,
        wouldQuery: queries.map((q) => q.key),
      },
    });
  }

  // The cohort feed for an area, from the weekly cache or a fresh (paid) read.
  const cohorts = cohortLoader(admin, { buy: true, maxBuys: COHORT_AREAS_PER_PASS, action: 'cron:marketplace-sweep', tag: 'marketplace-sweep' });

  for (const query of queries) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const res = await runMetered({ userId: null, admin: false, action: 'cron:marketplace-sweep', actionId: newActionId() }, () => ask(marketplaceListings, query, { mode: 'cron' }));
    if (!res.value) {
      summary.unavailable += 1;
      continue;
    }
    summary.answered += 1;
    if (res.cached) summary.cached += 1;
    summary.rawCostPence += res.costPence ?? 0;
    const listings = res.value;
    summary.listings += listings.length;
    if (listings.length === 0) continue;
    await cohorts.loadFor(query.area);
    summary.cohortAreas = cohorts.bought();
    await absorbListings(admin, ctx.cardByCode, ctx.rentTable, cohorts.index, query, listings, summary);
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
