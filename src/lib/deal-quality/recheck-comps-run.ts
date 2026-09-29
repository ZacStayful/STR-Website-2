import 'server-only';

/**
 * The one-off re-check of today's live deals (Batch 16, Part B): every live
 * deal still shown on the area's average gets its own comparables check,
 * sales by annual profit first and then rentals, within its own ceiling
 * (billing_settings.deal_checks recheckCeilingPence, over every run) and
 * the day's cap it shares with the nightly checks. A pass keeps the deal
 * live on its new figure; too few similar homes retires it as
 * insufficient_data; a figure under the bar retires it as unqualified.
 * Each run carries on where the last stopped, and is recorded in
 * marketplace_runs (kind 'deal_recheck', with who ran it). House spend.
 *
 * `retireUncheckedLive` is the other way to clear the old figures: every
 * live deal without a check retires as `unchecked`, which the next sweep
 * revives onto the shortlist when the listing is still in the feed, so it
 * comes back through a check. Both have a dry run.
 *
 * Entry points: /api/internal/deal-recheck (secret-gated, ?dry=1,
 * ?retire=1) and the /admin/deals buttons.
 */
import { createAdminClient } from '../supabase/admin';
import { COST_PENCE, providerEnabled } from '../broker/config';
import { DEAL_COLUMNS, loadScreenContext, loadSourcedListings, retireDeal, revalidateDeals, type Admin } from '../marketplace/server';
import type { DealRow } from '../marketplace/types';
import { streamOfRow } from './streams';
import { readDealQualitySettings } from './settings-server';
import { checkDeal, claimBook, loadTodayRuns, runPool, type CheckContext } from './checks-run';
import { callAffordable, DEAL_RECHECK_ACTION, DEAL_RECHECK_KIND, ukDayStart, worstCasePence, type CheckResult } from './checks';

const TIME_BUDGET_MS = 45_000;
const SNAPSHOT_WAIT_MS = 20_000;
const WORKERS = 3;
const MAX_PER_RUN = 200;
/** A deal whose search failed in one of the last few runs is left for a later one. */
const FAILED_MEMORY_RUNS = 3;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export interface RecheckOptions {
  dry: boolean;
  triggeredBy: string;
  max?: number;
}

export interface RecheckResult {
  status: number;
  body: Record<string, unknown>;
}

async function recordRun(admin: Admin, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind: DEAL_RECHECK_KIND, dry: false, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[deal-recheck] run record failed:', error.message);
}

/** Every run of the re-check so far: what it spent, and the deals whose search failed recently. */
async function loadRecheckHistory(admin: Admin): Promise<{ spentPence: number; recentlyFailed: Set<string> } | null> {
  const { data, error } = await admin.from('marketplace_runs').select('started_at, rawCostPence:summary->rawCostPence, failedIds:summary->failedIds').eq('kind', DEAL_RECHECK_KIND).eq('dry', false).order('started_at', { ascending: false }).limit(1000);
  if (error) {
    console.error('[deal-recheck] run history unreadable:', error.message);
    return null;
  }
  const rows = (data ?? []) as { started_at: string; rawCostPence: unknown; failedIds: unknown }[];
  const recentlyFailed = new Set<string>();
  for (const r of rows.slice(0, FAILED_MEMORY_RUNS)) if (Array.isArray(r.failedIds)) for (const id of r.failedIds) if (typeof id === 'string') recentlyFailed.add(id);
  return { spentPence: rows.reduce((n, r) => n + (num(r.rawCostPence) ?? 0), 0), recentlyFailed };
}

/** Live deals without a check of their own: sales by annual profit, then rentals. */
async function loadUnchecked(admin: Admin): Promise<DealRow[] | null> {
  const read = (kind: 'sale' | 'rent') => admin.from('marketplace_deals').select(DEAL_COLUMNS).eq('status', 'live').eq('kind', kind).is('screening->check', null).order('annual_profit', { ascending: false, nullsFirst: false }).limit(1000);
  const [sales, rents] = await Promise.all([read('sale'), read('rent')]);
  if (sales.error || rents.error) {
    console.error('[deal-recheck] live deals unreadable:', sales.error?.message ?? rents.error?.message);
    return null;
  }
  return [...((sales.data ?? []) as unknown as DealRow[]), ...((rents.data ?? []) as unknown as DealRow[])];
}

export async function runDealRecheck(opts: RecheckOptions): Promise<RecheckResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: RecheckResult): RecheckResult => {
    const { results: _r, wouldCheck: _w, failedIds: _f, ...rest } = result.body;
    void _r;
    void _w;
    void _f;
    console.log('[deal-recheck] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const settings = await readDealQualitySettings(admin);
  const s = settings.checks;
  const [history, spentToday, unchecked] = await Promise.all([loadRecheckHistory(admin), loadTodayRuns(admin, ukDayStart(startedAt)), loadUnchecked(admin)]);
  if (!history || !unchecked) return done({ status: 500, body: { error: 'Could not read the earlier runs or the live deals' } });
  const candidates = unchecked.filter((d) => !history.recentlyFailed.has(d.id));
  const ceilingLeft = Math.max(0, Math.round((s.recheckCeilingPence - history.spentPence) * 100) / 100);
  const dayLeft = Math.max(0, Math.round((s.dailyCapPence - (Number.isFinite(spentToday.pence) ? spentToday.pence : s.dailyCapPence)) * 100) / 100);
  const max = Math.max(0, Math.min(MAX_PER_RUN, Math.floor(opts.max ?? MAX_PER_RUN)));
  const plan = candidates.slice(0, max);
  const summary: Record<string, unknown> = {
    dry: opts.dry,
    triggeredBy: opts.triggeredBy,
    uncheckedLive: unchecked.length,
    leftForLater: history.recentlyFailed.size,
    ceilingPence: s.recheckCeilingPence,
    spentBeforePence: history.spentPence,
    ceilingLeftPence: ceilingLeft,
    dayLeftPence: dayLeft,
  };
  if (opts.dry) {
    const listings = await loadSourcedListings(admin, plan.map((d) => d.canonical_url));
    const worstEach = plan.map((d) => worstCasePence(s, COST_PENCE.airbticsBounds, (listings.get(d.canonical_url)?.listing.lat ?? null) === null));
    const worst = worstEach.reduce((a, b) => a + b, 0);
    const expected = Math.round(plan.length * 1.4 * COST_PENCE.airbticsBounds * 100) / 100;
    return done({ status: 200, body: { ...summary, planned: plan.length, worstCasePence: Math.round(worst * 100) / 100, expectedPence: expected, note: `Within the ceiling this run can afford about ${Math.floor(Math.min(ceilingLeft, dayLeft) / (1.4 * COST_PENCE.airbticsBounds))} checks at the measured 1.4 calls each.`, wouldCheck: plan.slice(0, 60).map((d) => `${d.postcode_area ?? '?'} · ${d.bedrooms ?? '?'} bed ${d.kind} · £${Math.round(num(d.annual_profit) ?? 0).toLocaleString('en-GB')}/yr`) } });
  }
  if (!providerEnabled('airbtics')) return done({ status: 503, body: { ...summary, error: 'AIRBTICS_API_KEY is not set here, so nothing was checked.' } });
  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return done({ status: 503, body: { ...summary, error: 'snapshot_warming' } });
  const listings = await loadSourcedListings(admin, plan.map((d) => d.canonical_url));
  // Two ceilings, one book: the job's own, and the day's cap shared with the nightly checks.
  const cap = Math.min(ceilingLeft, dayLeft);
  const book = claimBook(cap, 0);
  const stop: { by: 'time' | 'cap' | null } = { by: null };
  const cc: CheckContext = { admin, ctx, settings, via: 'recheck', action: DEAL_RECHECK_ACTION, tag: 'deal-recheck', claim: book.claim, release: book.release, now: startedAt };
  const outOfTime = () => elapsed() > TIME_BUDGET_MS;
  const outOfCap = () => !callAffordable(cap, book.claimed(), COST_PENCE.airbticsBounds);
  const results = await runPool(plan, WORKERS, () => outOfTime() || outOfCap(), async (deal): Promise<CheckResult> => {
    const found = listings.get(deal.canonical_url);
    if (!found) {
      await retireDeal(admin, deal.canonical_url, 'removed', startedAt);
      return { id: deal.id, area: deal.postcode_area, bedrooms: deal.bedrooms, kind: deal.kind, stream: streamOfRow(deal, settings.lowEntry), outcome: 'failed', confidence: null, comps: null, calls: 0, pence: 0, gross: null, areaGross: null, error: 'sourced listing gone' };
    }
    const r = await checkDeal(deal, found.listing, cc);
    if (r.outcome === 'stopped') stop.by = 'cap';
    return r;
  });
  if (stop.by === null && results.length < plan.length) stop.by = outOfCap() ? 'cap' : 'time';
  const stoppedBy = stop.by;
  const outcomes: Record<string, number> = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const checked = results.filter((r) => r.outcome !== 'failed' && r.outcome !== 'stopped').length;
  Object.assign(summary, {
    planned: plan.length,
    checked,
    outcomes,
    calls: results.reduce((n, r) => n + r.calls, 0),
    rawCostPence: Math.round(results.reduce((n, r) => n + r.pence, 0) * 100) / 100,
    left: unchecked.length - checked,
    failedIds: results.filter((r) => r.outcome === 'failed').map((r) => r.id),
    stoppedBy,
    results,
    ms: elapsed(),
  });
  await recordRun(admin, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}

export interface RetireUncheckedOptions {
  dry: boolean;
  triggeredBy: string;
}

/** Every live deal without a check retires as `unchecked` (the next sweep revives it onto the shortlist while it is in the feed). */
export async function retireUncheckedLive(opts: RetireUncheckedOptions): Promise<RecheckResult> {
  const startedAt = new Date();
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return { status: 503, body: { error: 'Storage not configured' } };
  }
  const { count, error } = await admin.from('marketplace_deals').select('canonical_url', { count: 'exact', head: true }).eq('status', 'live').is('screening->check', null);
  if (error) return { status: 500, body: { error: `Could not count the live deals: ${error.message}` } };
  const body: Record<string, unknown> = { dry: opts.dry, triggeredBy: opts.triggeredBy, uncheckedLive: count ?? 0 };
  if (opts.dry) return { status: 200, body: { ...body, note: `${count ?? 0} live deals would retire as unchecked and come back through a check when the sweep next sees them.` } };
  const nowIso = startedAt.toISOString();
  const { count: retired, error: retErr } = await admin.from('marketplace_deals').update({ status: 'retired', retired_reason: 'unchecked', retired_at: nowIso, check_requested_at: null, next_check_due_at: null, updated_at: nowIso }, { count: 'exact' }).eq('status', 'live').is('screening->check', null);
  if (retErr) return { status: 500, body: { ...body, error: `Retire failed: ${retErr.message}` } };
  const summary = { ...body, retiredUnchecked: retired ?? 0, rawCostPence: 0, ms: Date.now() - startedAt.getTime() };
  await recordRun(admin, startedAt, summary);
  revalidateDeals();
  return { status: 200, body: summary };
}
