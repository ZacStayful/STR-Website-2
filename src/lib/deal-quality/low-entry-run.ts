import 'server-only';

/**
 * The nationwide low-entry search (Batch 16, Part F): every UK postcode
 * area asked for sale listings up to the low-entry price cap, a slice of
 * the list each pass so each area comes round about weekly, screened into
 * the pool through the same absorber as the sweep. Its listings get their
 * stream from the deal model like every other (a £120,000 flat the house
 * finance gets into for £40,000 is low entry whichever search found it).
 *
 * An area with no card of its own (too few reports for a score) is screened
 * on its region's figures at low confidence, so a cheap listing in an area
 * the Explorer cannot rate is not lost: the deal's own comparables (Part B)
 * decide what is shown.
 *
 * Every pass claims the worst case of its next search against the week's
 * cap before asking (billing_settings.low_entry weeklyCapPence), records
 * what it finished in marketplace_runs (kind 'low_entry_search', with who
 * ran it), and later passes carry on from there. House spend.
 *
 * Entry points: /api/internal/low-entry-search (cron, secret-gated, ?dry=1)
 * and the /admin/deals buttons. OFF until LOW_ENTRY_SEARCH_ENABLED=true; a
 * dry run and the admin buttons work either way.
 */
import { createAdminClient } from '../supabase/admin';
import { ask, lowEntryListings } from '../broker';
import { runMetered, newActionId } from '../credit/context';
import { COST_PENCE } from '../broker/config';
import { pmiAccount, pmiConfigured } from '../broker/providers/pmi';
import { absorbListings, emptyAbsorbCounters, type AbsorbCounters } from '../marketplace/absorb';
import { loadScreenContext, revalidateDeals, type Admin } from '../marketplace/server';
import type { AreaCardLike } from '../marketplace/record';
import { getMarketSnapshot } from '../market/cached';
import { regionForArea } from '../market/regions';
import { areaMetaForCode } from '../market/areas';
import type { CohortMember } from '../listing/cohorts';
import { readDealQualitySettings } from './settings-server';
import { LOW_ENTRY_ACTION, LOW_ENTRY_HISTORY_DAYS, LOW_ENTRY_KIND, lowEntryAreas, planLowEntry, withinWeeklyCap, type LowEntryRunRecord } from './low-entry-plan';

const QUERY_BUDGET_MS = 44_000;
const SNAPSHOT_WAIT_MS = 20_000;
/** The most one pass may be asked to search, whatever the setting. */
const MAX_PER_PASS = 50;
/**
 * The worst case one search can cost: a PMI listings credit that comes back
 * empty (paid for all the same), then the OnTheMarket results page the
 * broker falls back to (unit_costs onthemarket/search_page, 0.2p nominal).
 */
const WORST_CASE_PENCE = COST_PENCE.pmiListings + 0.2;

export function lowEntrySearchEnabled(): boolean {
  return process.env.LOW_ENTRY_SEARCH_ENABLED === 'true';
}

export interface LowEntryOptions {
  dry: boolean;
  /** 'cron', 'internal', or the admin's email. */
  triggeredBy: string;
  /** Searches this pass may make; the setting's areasPerPass without it. */
  maxQueries?: number;
}

export interface LowEntrySummary extends AbsorbCounters {
  dry: boolean;
  enabled: boolean;
  triggeredBy: string;
  /** Areas on the list. */
  areas: number;
  /** Searches left to make when the pass started (the list minus what is done today). */
  pending: number;
  doneToday: number;
  weekStart: string;
  weekSpentPence: number;
  weekCapPence: number;
  searchMaxPrice: number;
  minBedrooms: number;
  maxCashIn: number;
  /** Searches this pass made (asked the broker, cached or not). */
  searched: number;
  answered: number;
  cached: number;
  unavailable: number;
  stale: number;
  listings: number;
  /** Of the areas left to search, how many are screened on their region's figures (no card of their own). */
  fallbackAreas: number;
  /** …and how many have neither: searched, but nothing found there can be screened. */
  unscreenable: number;
  doneKeys: string[];
  emptyKeys: string[];
  rawCostPence: number;
  stoppedBy: 'time' | 'cap' | 'max' | null;
  ms?: number;
  [k: string]: unknown;
}

export interface LowEntryResult {
  status: number;
  body: LowEntrySummary | { error: string; detail?: string };
}

/** Earlier passes over the last fortnight: what each finished and spent. */
async function loadHistory(admin: Admin, now: Date): Promise<LowEntryRunRecord[]> {
  const since = new Date(now.getTime() - LOW_ENTRY_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('marketplace_runs')
    .select('started_at, doneKeys:summary->doneKeys, rawCostPence:summary->rawCostPence')
    .eq('kind', LOW_ENTRY_KIND)
    .eq('dry', false)
    .gte('started_at', since);
  if (error) {
    // Unreadable: plan as if nothing were done and nothing spent. The cap then binds on this pass alone, which is the safe side.
    console.warn('[low-entry-search] run history unreadable:', error.message);
    return [];
  }
  return ((data ?? []) as { started_at: string; doneKeys: unknown; rawCostPence: unknown }[]).map((r) => ({ startedAt: r.started_at, doneKeys: r.doneKeys, rawCostPence: r.rawCostPence }));
}

/**
 * The area cards the absorber screens with, plus a region's figures standing
 * in for each area on the list that has no card (AreaCardLike.fallback: low
 * confidence whatever the bedroom match).
 */
async function cardsWithFallbacks(cardByCode: ReadonlyMap<string, AreaCardLike>, areas: readonly string[]): Promise<{ byCode: Map<string, AreaCardLike>; fallback: number; unscreenable: number }> {
  const byCode = new Map(cardByCode);
  let fallback = 0;
  let unscreenable = 0;
  const missing = areas.filter((a) => !byCode.has(a));
  if (missing.length === 0) return { byCode, fallback, unscreenable };
  const regions = await getMarketSnapshot()
    .then((s) => s.regions)
    .catch((err) => {
      console.warn('[low-entry-search] regions unreadable:', (err as Error)?.message ?? err);
      return [];
    });
  for (const area of missing) {
    const region = regions.find((r) => r.slug === regionForArea(area).slug);
    if (!region || !(Number(region.headline.grossRevenue) > 0)) {
      unscreenable += 1;
      continue;
    }
    const meta = areaMetaForCode(area);
    byCode.set(area, {
      code: meta.code,
      name: meta.name,
      slug: meta.slug,
      byBedrooms: region.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })),
      headline: { grossRevenue: region.headline.grossRevenue, adr: region.headline.adr },
      score: null,
      fallback: true,
    });
    fallback += 1;
  }
  return { byCode, fallback, unscreenable };
}

async function recordRun(admin: Admin, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: LOW_ENTRY_KIND, dry: false, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[low-entry-search] run record failed:', error.message);
}

export async function runLowEntrySearch(opts: LowEntryOptions): Promise<LowEntryResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: LowEntryResult): LowEntryResult => {
    const body = result.body as Record<string, unknown>;
    const { wouldQuery: _w, doneKeys: _d, emptyKeys: _e, ...rest } = body;
    void _w;
    void _d;
    void _e;
    console.log('[low-entry-search] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
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
  const settings = (await readDealQualitySettings(admin)).lowEntry;
  const history = await loadHistory(admin, startedAt);
  const areas = lowEntryAreas();
  const plan = planLowEntry(areas, history, settings, startedAt);
  const max = Math.max(1, Math.min(MAX_PER_PASS, Math.floor(opts.maxQueries ?? settings.areasPerPass)));
  const next = plan.pending.slice(0, max);
  const { byCode, fallback, unscreenable } = await cardsWithFallbacks(ctx.cardByCode, next.map((q) => q.area));

  const summary: LowEntrySummary = {
    dry: opts.dry,
    enabled: lowEntrySearchEnabled(),
    triggeredBy: opts.triggeredBy,
    areas: areas.length,
    pending: plan.pending.length,
    doneToday: plan.doneToday,
    weekStart: plan.weekStart,
    weekSpentPence: plan.weekSpentPence,
    weekCapPence: settings.weeklyCapPence,
    searchMaxPrice: settings.searchMaxPrice,
    minBedrooms: settings.minBedrooms,
    maxCashIn: settings.maxCashIn,
    searched: 0,
    answered: 0,
    cached: 0,
    unavailable: 0,
    stale: 0,
    listings: 0,
    fallbackAreas: fallback,
    unscreenable,
    doneKeys: [],
    emptyKeys: [],
    ...emptyAbsorbCounters(),
    rawCostPence: 0,
    stoppedBy: null,
  };

  if (opts.dry) {
    const account = pmiConfigured() ? await pmiAccount().catch(() => null) : null;
    return done({
      status: 200,
      body: {
        ...summary,
        // Worst case: every search this pass would make answered by PMI, then the fallback page.
        estimatedRawPence: Math.round(next.length * WORST_CASE_PENCE * 100) / 100,
        weekLeftPence: Math.max(0, Math.round((settings.weeklyCapPence - plan.weekSpentPence) * 100) / 100),
        pmi: account ? { plan: account.plan ?? null, creditsMonthly: account.credits_monthly ?? null, creditsRemaining: account.credits_remaining ?? null } : null,
        wouldQuery: next.map((q) => `${q.area} ${q.areaName}${byCode.get(q.area)?.fallback ? ' (region figures)' : byCode.has(q.area) ? '' : ' (cannot be screened)'}`),
      },
    });
  }

  const noCohorts = new Map<string, CohortMember>();
  for (const query of next) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.stoppedBy = 'time';
      break;
    }
    if (!withinWeeklyCap(settings.weeklyCapPence, plan.weekSpentPence, summary.rawCostPence, WORST_CASE_PENCE)) {
      summary.stoppedBy = 'cap';
      break;
    }
    summary.searched += 1;
    const res = await runMetered({ userId: null, admin: false, action: LOW_ENTRY_ACTION, actionId: newActionId() }, () => ask(lowEntryListings, query, { mode: 'cron' }));
    if (!res.value) {
      summary.unavailable += 1;
      summary.emptyKeys.push(query.key);
      continue;
    }
    if (res.stale) {
      // Only the broker's expired copy, because every source failed: screened, but not today's search.
      summary.unavailable += 1;
      summary.stale += 1;
    } else {
      summary.answered += 1;
      if (res.cached) summary.cached += 1;
    }
    summary.rawCostPence += res.costPence ?? 0;
    summary.listings += res.value.length;
    // No PropertyData cohort buys here: this search counts every penny against its own cap.
    if (res.value.length > 0) await absorbListings(admin, byCode, ctx.rentTable, ctx.r2rBar, noCohorts, query, res.value, summary, 'low-entry-search', ctx.rules);
    (res.stale ? summary.emptyKeys : summary.doneKeys).push(query.key);
  }
  if (summary.stoppedBy === null && summary.searched >= max && plan.pending.length > max) summary.stoppedBy = 'max';

  summary.ms = elapsed();
  await recordRun(admin, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}

export interface LowEntryRunRow {
  id: string;
  started_at: string;
  summary: Record<string, unknown>;
}

/** The latest real passes, newest first, for /admin/deals. */
export async function latestLowEntryRuns(admin: Admin, limit = 7): Promise<LowEntryRunRow[]> {
  const { data, error } = await admin.from('marketplace_runs').select('id, started_at, summary').eq('kind', LOW_ENTRY_KIND).eq('dry', false).order('started_at', { ascending: false }).limit(limit);
  if (error) {
    console.error('[low-entry-search] runs unreadable:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string; started_at: string; summary: Record<string, unknown> | null }[]).map((r) => ({ id: r.id, started_at: r.started_at, summary: r.summary ?? {} }));
}
