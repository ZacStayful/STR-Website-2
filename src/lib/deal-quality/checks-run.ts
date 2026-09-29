import 'server-only';

/**
 * The daily paid checks (Batch 16, Part B), server side: the nightly job
 * that takes the day's checks from the shortlist (checks.ts has the rules),
 * and `checkDeal`, the check itself, shared with the one-off re-check of
 * live deals (recheck-comps-run.ts).
 *
 * A check: the listing's own coordinates (its full postcode geocoded when
 * the feed gave none), the comparables search through the broker
 * (search.ts: Airbtics' listings search, nearest first, 5p a call, each
 * call claimed against the day's cap before it is made), the analyser's
 * pipeline on what came back, and the deal re-screened on the figure it
 * gave. Too few similar homes within the widest radius retires the deal as
 * insufficient_data (never shown, never revived); a figure under the bar
 * retires it as unqualified; the rest go on to their entry page read
 * (pending_verify) or straight live, with the check kept on the screening
 * and an analyser_reports row (source deal_comps) for the area figures.
 *
 * Every run is recorded in marketplace_runs (kind 'deal_checks', with who
 * ran it); today's runs of both jobs are what the day's cap is read from.
 * House spend. Entry points: /api/internal/deal-checks (cron, secret-gated,
 * ?dry=1) and the /admin/deals buttons. OFF until DEAL_CHECKS_ENABLED=true:
 * with it off nothing is shortlisted, so there is nothing to check; a dry
 * run and the admin buttons work either way.
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { COST_PENCE, providerEnabled } from '../broker/config';
import { geocodePostcode } from '../apis/geocode';
import { defaultGuests } from '../listing/normalise';
import { serverFetchEnabled } from '../listing/fetch';
import type { SourcedListing } from '../listing/sourcing';
import { buildDealRecord, qualifiesForMarketplace } from '../marketplace/record';
import { DEAL_COLUMNS, loadScreenContext, loadSourcedListings, recordColumns, retireDeal, revalidateDeals, writeWithoutMissing, type Admin, type ScreenContext } from '../marketplace/server';
import { nextCheckDueAt } from '../marketplace/cadence';
import type { DealRow } from '../marketplace/types';
import { DAY_STREAMS, perStream, STREAMS, streamOfRow, type Stream } from './streams';
import { projectStreamUrls } from '../project/read-server';
import { dealChecksEnabled, readDealQualitySettings, type DealQualitySettings } from './settings-server';
import { DEAL_CHECK_VARIANT, incomeFromComps, searchDealComps } from './search';
import {
  allocateSlots,
  callAffordable,
  checkOf,
  checkOutcome,
  daySpend,
  DEAL_CHECKS_ACTION,
  DEAL_CHECKS_KIND,
  DEAL_RECHECK_KIND,
  GEOCODE_PENCE,
  MAX_CHECK_ATTEMPTS,
  reportRowFor,
  shortlistOrder,
  storedCheckFrom,
  subjectKindFor,
  ukDayStart,
  worstCasePence,
  type CheckResult,
  type DaySpend,
} from './checks';

const TIME_BUDGET_MS = 45_000;
const SNAPSHOT_WAIT_MS = 20_000;
const WORKERS = 3;
/** The most one run may be asked to check, whatever the setting. */
const MAX_PER_RUN = 200;
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

// ── The check itself ──

export interface CheckContext {
  admin: Admin;
  ctx: ScreenContext;
  settings: DealQualitySettings;
  via: 'daily' | 'recheck';
  /** provider_calls.action the calls are logged under. */
  action: string;
  tag: string;
  /** Claims this much raw pence against the day's cap before a call is made; false stops the check. */
  claim: (pence: number) => boolean;
  /** Gives a claim back when no call was made (a cached answer, a failed call). */
  release: (pence: number) => void;
  now: Date;
}

/** The area figure the deal was screened on before the check, for the record. */
function areaGrossOf(deal: DealRow): number | null {
  const g = (deal.screening as { grossRevenue?: { value?: unknown; source?: unknown } } | null)?.grossRevenue;
  return g && g.source !== 'checked' ? num(g.value) : null;
}

/**
 * One deal's own comparables check, and what it does to the row. Returns
 * what happened and what it cost; never where the deal is.
 */
export async function checkDeal(deal: DealRow, listing: SourcedListing, cc: CheckContext): Promise<CheckResult> {
  const { admin, ctx, settings, now } = cc;
  const nowIso = now.toISOString();
  const stream = streamOfRow(deal, settings.lowEntry);
  const base: CheckResult = { id: deal.id, area: deal.postcode_area, bedrooms: listing.bedrooms ?? deal.bedrooms, kind: listing.kind, stream, outcome: 'failed', confidence: null, comps: null, calls: 0, pence: 0, gross: null, areaGross: areaGrossOf(deal) };
  const bedrooms = listing.bedrooms ?? deal.bedrooms;
  const fail = async (error: string, outcome: CheckResult['outcome'] = 'failed'): Promise<CheckResult> => {
    if (outcome === 'failed' && deal.status === 'pending_check') {
      // The search failed: the deal stays shortlisted for another try; too many tries and it is let go.
      const failures = (deal.check_failures ?? 0) + 1;
      if (failures >= MAX_CHECK_ATTEMPTS) await retireDeal(admin, deal.canonical_url, 'unverifiable', now);
      else {
        const { error: err } = await admin.from('marketplace_deals').update({ check_failures: failures, updated_at: nowIso }).eq('canonical_url', deal.canonical_url);
        if (err) console.error(`[${cc.tag}] failure update failed:`, err.message);
      }
    }
    return { ...base, outcome, error };
  };
  const insufficient = async (error: string): Promise<CheckResult> => {
    await retireDeal(admin, deal.canonical_url, 'insufficient_data', now);
    return { ...base, outcome: 'insufficient', error };
  };
  if (bedrooms === null || bedrooms < 0) return insufficient('no bedroom count');

  return runMetered({ userId: null, admin: false, action: cc.action, actionId: newActionId() }, async (): Promise<CheckResult> => {
    // Its own location: the feed's coordinates, else its full postcode geocoded (OnTheMarket's feed carries them; Rightmove's does not).
    let lat = listing.lat;
    let lng = listing.lng;
    let pence = 0;
    if (lat === null || lng === null) {
      const postcode = listing.postcode?.trim() ?? '';
      if (!FULL_POSTCODE.test(postcode)) return insufficient('no coordinates and no full postcode');
      if (!cc.claim(GEOCODE_PENCE)) return { ...base, outcome: 'stopped', error: 'the day’s cap' };
      try {
        const g = await geocodePostcode(postcode);
        lat = g.lat;
        lng = g.lng;
        pence += GEOCODE_PENCE;
      } catch (err) {
        cc.release(GEOCODE_PENCE);
        return fail(`geocode failed: ${(err as Error)?.message ?? err}`);
      }
    }
    const subject = { lat, lng, bedrooms, kind: subjectKindFor(listing.rawType), postcode: listing.postcode ?? listing.outcode ?? '' };
    const search = await searchDealComps(subject, settings.comps, {
      maxCalls: settings.checks.maxCallsPerCheck,
      claim: () => cc.claim(COST_PENCE.airbticsBounds),
      release: () => cc.release(COST_PENCE.airbticsBounds),
    });
    pence += search.pence;
    const found = { ...base, calls: search.calls, pence: Math.round(pence * 100) / 100 };
    if (search.steps.length === 0) return search.stopped ? { ...found, outcome: 'stopped', error: 'the day’s cap' } : { ...(await fail('search failed')), calls: search.calls, pence: found.pence };
    const guests = defaultGuests(bedrooms);
    const figures = incomeFromComps(search.comps, { ...subject, guests, options: listing.bathrooms ? { bathrooms: listing.bathrooms } : undefined }, search.radiusKm, DEAL_CHECK_VARIANT, settings.confidence, settings.comps.minComps);
    const confidence = figures?.confidence ?? 'insufficient';
    if (!figures || confidence === 'insufficient') {
      const r = await insufficient(`${search.comps.length} similar homes within ${search.radiusKm} km`);
      return { ...r, calls: search.calls, pence: found.pence, comps: search.comps.length };
    }
    const check = storedCheckFrom({ ...figures, confidence }, search, { bedrooms, kind: listing.kind }, cc.via, now);
    const card = (listing.postcodeArea ? ctx.cardByCode.get(listing.postcodeArea) : null) ?? (deal.postcode_area ? ctx.cardByCode.get(deal.postcode_area) : null) ?? null;
    const rec = buildDealRecord(listing, { card, rentTable: ctx.rentTable, r2rBar: ctx.r2rBar, rules: ctx.rules, check, firstSeenAt: deal.first_seen_at, now });
    const withFigure = { ...found, confidence: check.confidence, comps: check.compCount, gross: check.gross };
    if (checkOutcome(true, qualifiesForMarketplace(rec)) === 'unqualified') {
      await retireDeal(admin, deal.canonical_url, 'unqualified', now);
      return { ...withFigure, outcome: 'unqualified' };
    }
    const fetchable = serverFetchEnabled(listing.source);
    // A shortlisted deal goes on to its entry page read (or straight live where the source is never fetched); a live deal stays as it is with its new figure.
    // Batch 17: a Project candidate stays shortlisted with its check, for the Project photo check (src/lib/project/check-run.ts).
    const advance = deal.status === 'pending_check' && stream !== 'project';
    const update: Record<string, unknown> = {
      ...recordColumns(listing, rec),
      // Batch 17: the record's own stream is never 'project'; a held candidate keeps it.
      ...(stream === 'project' ? { stream: 'project' } : {}),
      updated_at: nowIso,
      ...(advance
        ? { status: fetchable ? 'pending_verify' : 'live', next_check_due_at: fetchable ? nowIso : nextCheckDueAt(listing.kind, rec.annualProfit, now), check_failures: 0, last_seen_at: nowIso }
        : {}),
    };
    const { error } = await writeWithoutMissing(update, (u) => admin.from('marketplace_deals').update(u).eq('canonical_url', deal.canonical_url), cc.tag);
    if (error) {
      console.error(`[${cc.tag}] check write failed:`, error.message);
      return { ...withFigure, outcome: 'failed', error: `write failed: ${error.message}` };
    }
    // The area figures the free screening reads get better as the checks run: the check as an analyser_reports row, keyed on the deal.
    const row = reportRowFor({ dealId: deal.id, checkedAt: nowIso, outcode: listing.outcode ?? deal.outcode, postcodeArea: listing.postcodeArea ?? deal.postcode_area, bedrooms, guests, lat, lng, check, data: figures.data, quality: figures.quality });
    const { error: delErr } = await admin.from('analyser_reports').delete().eq('source', String(row.source)).eq('request_id', deal.id);
    if (delErr) console.error(`[${cc.tag}] report row replace failed:`, delErr.message);
    const { error: insErr } = await admin.from('analyser_reports').insert(row);
    if (insErr) console.error(`[${cc.tag}] report row write failed:`, insErr.message);
    return { ...withFigure, outcome: advance ? (fetchable ? 'pending_verify' : 'live') : deal.status === 'pending_check' ? 'held' : 'live' };
  });
}

/** A claim book for one run: the day's cap less what earlier runs spent, less what this run has claimed. */
export function claimBook(capPence: number, spentBefore: number): { claim: (p: number) => boolean; release: (p: number) => void; claimed: () => number } {
  let claimed = 0;
  return {
    claim: (p) => {
      if (!callAffordable(capPence, spentBefore + claimed, p)) return false;
      claimed += p;
      return true;
    },
    release: (p) => {
      claimed = Math.max(0, claimed - p);
    },
    claimed: () => Math.round(claimed * 100) / 100,
  };
}

/** Runs `fn` over `items` with at most `workers` in flight; stops taking new items once `stop()` says so. */
export async function runPool<T, R>(items: readonly T[], workers: number, stop: () => boolean, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stop()) {
      const item = items[next];
      next += 1;
      out.push(await fn(item));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
  return out;
}

// ── The nightly job ──

export interface ChecksRunOptions {
  dry: boolean;
  /** 'cron', 'internal', or the admin's email. */
  triggeredBy: string;
  /** Checks this run may make; the day's slots without it. */
  max?: number;
}

export interface ChecksRunResult {
  status: number;
  body: Record<string, unknown>;
}

/** Today's runs of both checking jobs, for the day's cap. */
export async function loadTodayRuns(admin: Admin, dayStart: Date): Promise<DaySpend> {
  const { data, error } = await admin.from('marketplace_runs').select('started_at, summary').in('kind', [DEAL_CHECKS_KIND, DEAL_RECHECK_KIND]).eq('dry', false).gte('started_at', dayStart.toISOString()).limit(500);
  if (error) {
    // Unreadable: plan as if the whole cap were spent, which is the safe side.
    console.warn('[deal-checks] run history unreadable:', error.message);
    return { runs: 0, checked: perStream(() => 0), pence: Number.POSITIVE_INFINITY };
  }
  return daySpend(((data ?? []) as { started_at: string; summary: unknown }[]).map((r) => ({ startedAt: r.started_at, summary: r.summary })), dayStart);
}

/**
 * The shortlist: every deal waiting for its check, most profitable first.
 * Batch 17: a row held for its Project check carries stream 'project' (read
 * on its own: the column is not in DEAL_COLUMNS), and only those still
 * without a check of their own wait here; the rest wait on the Project job.
 */
export async function loadShortlist(admin: Admin): Promise<DealRow[] | null> {
  const [{ data, error }, project] = await Promise.all([
    admin.from('marketplace_deals').select(DEAL_COLUMNS).eq('status', 'pending_check').lt('check_failures', MAX_CHECK_ATTEMPTS).order('annual_profit', { ascending: false, nullsFirst: false }).limit(2000),
    projectStreamUrls(admin),
  ]);
  if (error) {
    console.error('[deal-checks] shortlist unreadable:', error.message);
    return null;
  }
  const rows = (data ?? []) as unknown as DealRow[];
  return rows.flatMap((r) => (project.has(r.canonical_url) ? (checkOf(r.screening) ? [] : [{ ...r, stream: 'project' as const }]) : [r]));
}

async function recordRun(admin: Admin, kind: string, startedAt: Date, summary: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('marketplace_runs').insert({ kind, dry: false, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
  if (error) console.error('[deal-checks] run record failed:', error.message);
}

/** Every stream's checks interleaved, so a run that runs out of time has advanced each. */
function interleave(byStream: Record<Stream, DealRow[]>): DealRow[] {
  const out: DealRow[] = [];
  const longest = Math.max(...STREAMS.map((s) => byStream[s].length));
  for (let i = 0; i < longest; i += 1) for (const s of STREAMS) if (byStream[s][i]) out.push(byStream[s][i]);
  return out;
}

export async function runDealChecks(opts: ChecksRunOptions): Promise<ChecksRunResult> {
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: ChecksRunResult): ChecksRunResult => {
    const { results: _r, wouldCheck: _w, ...rest } = result.body;
    void _r;
    void _w;
    console.log('[deal-checks] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
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
  const dayStart = ukDayStart(startedAt);
  const spent = await loadTodayRuns(admin, dayStart);
  const nowIso = startedAt.toISOString();

  // Shortlisted deals past their expiry are let go unchecked (revived like any unqualified deal when the feed brings them back).
  const { count: expiring, error: expErr } = await admin.from('marketplace_deals').select('canonical_url', { count: 'exact', head: true }).eq('status', 'pending_check').lt('next_check_due_at', nowIso);
  if (expErr) console.warn('[deal-checks] expiry count failed:', expErr.message);
  let expired = 0;
  if (!opts.dry && (expiring ?? 0) > 0) {
    const { count, error } = await admin.from('marketplace_deals').update({ status: 'retired', retired_reason: 'unchecked', retired_at: nowIso, next_check_due_at: null, updated_at: nowIso }, { count: 'exact' }).eq('status', 'pending_check').lt('next_check_due_at', nowIso);
    if (error) console.error('[deal-checks] expiry failed:', error.message);
    else expired = count ?? 0;
  }

  const shortlist = await loadShortlist(admin);
  if (!shortlist) return done({ status: 500, body: { error: 'Could not read the shortlist' } });
  const byStream = perStream((): DealRow[] => []);
  for (const row of shortlist) byStream[streamOfRow(row, settings.lowEntry)].push(row);
  const waiting = perStream((st) => byStream[st].length);
  // Batch 17: the Project stream's checks are its own count, on top of the day's (DAY_STREAMS).
  const checkedToday = DAY_STREAMS.reduce((n, st) => n + spent.checked[st], 0);
  const runMax = Math.min(MAX_PER_RUN, Math.floor(opts.max ?? Number.POSITIVE_INFINITY));
  const left = Math.max(0, Math.min(s.perDay - checkedToday, runMax));
  const dayOnly = allocateSlots(s.split, waiting, left);
  const dayAllocated = DAY_STREAMS.reduce((n, st) => n + dayOnly[st], 0);
  const projectLeft = Math.max(0, Math.min(s.split.project - spent.checked.project, runMax - dayAllocated));
  const slots = allocateSlots(s.split, waiting, left, projectLeft);
  const chosen = perStream((st) => shortlistOrder(byStream[st]).slice(0, slots[st]));
  const plan = interleave(chosen);
  const capLeft = Math.max(0, Math.round((s.dailyCapPence - spent.pence) * 100) / 100);

  const summary: Record<string, unknown> = {
    dry: opts.dry,
    enabled: dealChecksEnabled(),
    triggeredBy: opts.triggeredBy,
    day: dayStart.toISOString(),
    perDay: s.perDay,
    capPence: s.dailyCapPence,
    spentBeforePence: Number.isFinite(spent.pence) ? spent.pence : null,
    checkedBefore: spent.checked,
    capLeftPence: Number.isFinite(capLeft) ? capLeft : 0,
    checksLeft: left,
    projectChecksLeft: projectLeft,
    waiting,
    slots,
    expired: opts.dry ? expiring ?? 0 : expired,
  };

  if (opts.dry) {
    const listings = await loadSourcedListings(admin, plan.map((d) => d.canonical_url));
    const worst = plan.reduce((sum, d) => sum + worstCasePence(s, COST_PENCE.airbticsBounds, (listings.get(d.canonical_url)?.listing.lat ?? null) === null), 0);
    return done({
      status: 200,
      body: {
        ...summary,
        worstCasePence: Math.round(worst * 100) / 100,
        wouldCheck: plan.map((d) => `${d.postcode_area ?? '?'} · ${d.bedrooms ?? '?'} bed ${d.kind} · ${streamOfRow(d, settings.lowEntry)} · £${Math.round(num(d.annual_profit) ?? 0).toLocaleString('en-GB')}/yr`),
      },
    });
  }
  if (!providerEnabled('airbtics')) return done({ status: 503, body: { ...summary, error: 'AIRBTICS_API_KEY is not set here, so nothing was checked.' } });

  const ctx = await loadScreenContext(SNAPSHOT_WAIT_MS);
  if (ctx === null) return done({ status: 503, body: { ...summary, error: 'snapshot_warming' } });
  if (plan.length === 0 && expired === 0) return done({ status: 200, body: { ...summary, planned: 0, note: 'Nothing to check: the shortlist is empty or the day is spent.' } });
  const listings = await loadSourcedListings(admin, plan.map((d) => d.canonical_url));
  const spentBefore = Number.isFinite(spent.pence) ? spent.pence : s.dailyCapPence;
  const book = claimBook(s.dailyCapPence, spentBefore);
  const stop: { by: 'time' | 'cap' | null } = { by: null };
  const cc: CheckContext = { admin, ctx, settings, via: 'daily', action: DEAL_CHECKS_ACTION, tag: 'deal-checks', claim: book.claim, release: book.release, now: startedAt };
  const outOfTime = () => elapsed() > TIME_BUDGET_MS;
  const outOfCap = () => !callAffordable(s.dailyCapPence, spentBefore + book.claimed(), COST_PENCE.airbticsBounds);
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

  const checked = perStream(() => 0);
  const outcomes: Record<string, number> = {};
  for (const r of results) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.outcome !== 'failed' && r.outcome !== 'stopped') checked[r.stream] += 1;
  }
  const calls = results.reduce((n, r) => n + r.calls, 0);
  const rawCostPence = Math.round(results.reduce((n, r) => n + r.pence, 0) * 100) / 100;
  Object.assign(summary, { planned: plan.length, checked, outcomes, calls, rawCostPence, stoppedBy, results, ms: elapsed() });
  await recordRun(admin, DEAL_CHECKS_KIND, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}

export interface CheckRunRow {
  id: string;
  kind: string;
  started_at: string;
  summary: Record<string, unknown>;
}

/** The latest real runs of both checking jobs, newest first, for /admin/deals. */
export async function latestCheckRuns(admin: Admin, limit = 10): Promise<CheckRunRow[]> {
  const { data, error } = await admin.from('marketplace_runs').select('id, kind, started_at, summary').in('kind', [DEAL_CHECKS_KIND, DEAL_RECHECK_KIND]).eq('dry', false).order('started_at', { ascending: false }).limit(limit);
  if (error) {
    console.error('[deal-checks] runs unreadable:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string; kind: string; started_at: string; summary: Record<string, unknown> | null }[]).map((r) => ({ id: r.id, kind: r.kind, started_at: r.started_at, summary: r.summary ?? {} }));
}

export interface ChecksView {
  enabled: boolean;
  day: string;
  spent: DaySpend;
  capPence: number;
  perDay: number;
  /** Deals waiting on the shortlist, by stream. */
  waiting: Record<Stream, number>;
  /** Live deals without a check of their own. */
  uncheckedLive: number;
  /** Live deals shown on their own check. */
  checkedLive: number;
  /** What the one-off re-check has spent so far against its ceiling, and how many it has left. */
  recheckSpentPence: number;
  recheckCeilingPence: number;
  runs: CheckRunRow[];
}

/** What /admin/deals shows of the checks. Null when the rows cannot be read. */
export async function checksView(admin: Admin, settings: DealQualitySettings, now: Date = new Date()): Promise<ChecksView | null> {
  const dayStart = ukDayStart(now);
  const [spent, shortlist, runs, unchecked, checkedLive, recheckRuns] = await Promise.all([
    loadTodayRuns(admin, dayStart),
    loadShortlist(admin),
    latestCheckRuns(admin, 12),
    admin.from('marketplace_deals').select('canonical_url', { count: 'exact', head: true }).eq('status', 'live').is('screening->check', null),
    admin.from('marketplace_deals').select('canonical_url', { count: 'exact', head: true }).eq('status', 'live').not('screening->check', 'is', null),
    admin.from('marketplace_runs').select('rawCostPence:summary->rawCostPence').eq('kind', DEAL_RECHECK_KIND).eq('dry', false).limit(1000),
  ]);
  if (!shortlist) return null;
  const waiting = perStream(() => 0);
  for (const row of shortlist) waiting[streamOfRow(row, settings.lowEntry)] += 1;
  const recheckSpent = ((recheckRuns.data ?? []) as { rawCostPence: unknown }[]).reduce((n, r) => n + (num(r.rawCostPence) ?? 0), 0);
  return {
    enabled: dealChecksEnabled(),
    day: dayStart.toISOString(),
    spent,
    capPence: settings.checks.dailyCapPence,
    perDay: settings.checks.perDay,
    waiting,
    uncheckedLive: unchecked.count ?? 0,
    checkedLive: checkedLive.count ?? 0,
    recheckSpentPence: Math.round(recheckSpent * 100) / 100,
    recheckCeilingPence: settings.checks.recheckCeilingPence,
    runs,
  };
}
