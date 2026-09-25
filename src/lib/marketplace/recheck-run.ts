import 'server-only';

/**
 * The hourly marketplace recheck: retire what has aged out without a fetch,
 * then spend this hour's page fetches where they matter — new deals waiting
 * for their entry check, opens that could not verify, what members have been
 * looking at, rentals, the top bands, then the tail oldest-confirmed first
 * (see cadence.ts). Each portal is capped per run so a run can never be the
 * burst that trips its circuit breaker for everyone.
 *
 * Entry points: /api/internal/marketplace-recheck (cron, secret-gated) and
 * the /admin/deals button. MARKETPLACE_RECHECK_ENABLED=false is the kill switch.
 */
import { createAdminClient } from '../supabase/admin';
import { runMetered, newActionId } from '../credit/context';
import { serverFetchEnabled } from '../listing/fetch';
import { retirementFor, orderDueQueue, SOURCE_HOURLY_CAPS, SHOWN_RECENTLY_MS, type DueRow } from './cadence';
import type { DealRow } from './types';
import { applyLiveResult, fetchDealPage, loadScreenContext, loadSourcedListings, recordRun, retireDeal, revalidateDeals, DEAL_COLUMNS, type Admin } from './server';

const TIME_BUDGET_MS = 50_000;
const SNAPSHOT_WAIT_MS = 15_000;
const PAGE = 1000;
const CANDIDATE_LIMIT = 3000;
const FETCH_GAP_MS = 1000;

export function recheckEnabled(): boolean {
  return process.env.MARKETPLACE_RECHECK_ENABLED !== 'false';
}

function caps(): Record<string, number> {
  const out = { ...SOURCE_HOURLY_CAPS };
  const rm = Number(process.env.MARKETPLACE_RECHECK_CAP_RIGHTMOVE);
  const otm = Number(process.env.MARKETPLACE_RECHECK_CAP_OTM);
  if (Number.isFinite(rm) && rm >= 0) out.rightmove = Math.floor(rm);
  if (Number.isFinite(otm) && otm >= 0) out.onthemarket = Math.floor(otm);
  for (const source of Object.keys(out)) if (!serverFetchEnabled(source as 'rightmove' | 'onthemarket')) delete out[source];
  return out;
}

export interface RecheckSummary {
  dry: boolean;
  enabled: boolean;
  retiredStale: Partial<Record<string, number>>;
  candidates: number;
  due: number;
  fetched: number;
  live: number;
  retired: Partial<Record<string, number>>;
  failed: number;
  paused: boolean;
  caps: Record<string, number>;
  ranOutOfTime: boolean;
  ms?: number;
  [k: string]: unknown;
}

export interface RecheckResult {
  status: number;
  body: RecheckSummary | { error: string; detail?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMarketplaceRecheck(opts: { dry: boolean }): Promise<RecheckResult> {
  const startedAt = new Date();
  const now = startedAt;
  const elapsed = () => Date.now() - startedAt.getTime();
  const done = (result: RecheckResult): RecheckResult => {
    const body = result.body as Record<string, unknown>;
    const { wouldFetch: _w, wouldRetire: _r, ...rest } = body;
    void _w;
    void _r;
    console.log('[marketplace-recheck] run', JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: 'Storage not configured' } });
  }
  const summary: RecheckSummary = { dry: opts.dry, enabled: recheckEnabled(), retiredStale: {}, candidates: 0, due: 0, fetched: 0, live: 0, retired: {}, failed: 0, paused: false, caps: caps(), ranOutOfTime: false };

  // ── Retire without a fetch: aged out, or nothing has confirmed it for weeks ──
  const stale: { canonical_url: string; reason: 'stale_listed' | 'stale_unseen' }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('marketplace_deals')
      .select('canonical_url, listed_date, first_seen_at, last_confirmed_at')
      .in('status', ['live', 'pending_verify'])
      .order('canonical_url', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[marketplace-recheck] stale select failed:', error.message);
      break;
    }
    for (const r of (data ?? []) as { canonical_url: string; listed_date: string | null; first_seen_at: string; last_confirmed_at: string }[]) {
      const reason = retirementFor(r, now);
      if (reason) stale.push({ canonical_url: r.canonical_url, reason });
    }
    if ((data?.length ?? 0) < PAGE) break;
  }
  for (const s of stale) summary.retiredStale[s.reason] = (summary.retiredStale[s.reason] ?? 0) + 1;
  if (!opts.dry) {
    for (const reason of ['stale_listed', 'stale_unseen'] as const) {
      const urls = stale.filter((s) => s.reason === reason).map((s) => s.canonical_url);
      for (let i = 0; i < urls.length; i += 200) {
        const { error } = await admin.from('marketplace_deals').update({ status: 'retired', retired_reason: reason, retired_at: now.toISOString(), next_check_due_at: null, check_requested_at: null, updated_at: now.toISOString() }).in('canonical_url', urls.slice(i, i + 200));
        if (error) console.error('[marketplace-recheck] stale retire failed:', error.message);
      }
    }
  }

  // ── The due queue ──
  const shownSince = new Date(now.getTime() - SHOWN_RECENTLY_MS).toISOString();
  const { data: candRows, error: candErr } = await admin
    .from('marketplace_deals')
    .select('canonical_url, source, kind, status, annual_profit, last_checked_live_at, last_confirmed_at, next_check_due_at, check_requested_at, last_shown_at')
    .in('status', ['live', 'pending_verify'])
    .in('source', Object.keys(summary.caps))
    .or(`status.eq.pending_verify,check_requested_at.not.is.null,next_check_due_at.is.null,next_check_due_at.lte.${now.toISOString()},last_shown_at.gte.${shownSince}`)
    .order('next_check_due_at', { ascending: true, nullsFirst: true })
    .limit(CANDIDATE_LIMIT);
  if (candErr) {
    console.error('[marketplace-recheck] candidates select failed:', candErr.message);
    return done({ status: 500, body: { error: 'Query failed' } });
  }
  const candidates = (candRows ?? []) as DueRow[];
  summary.candidates = candidates.length;
  const queue = orderDueQueue(candidates, now, summary.caps);
  summary.due = queue.length;

  if (opts.dry) {
    return done({ status: 200, body: { ...summary, wouldRetire: stale.slice(0, 50), wouldFetch: queue.map((r) => ({ url: r.canonical_url, source: r.source, kind: r.kind, status: r.status })) } });
  }

  const ctx = queue.length > 0 ? await loadScreenContext(SNAPSHOT_WAIT_MS) : null;
  if (queue.length > 0 && ctx === null) {
    await recordRun(admin, 'recheck', false, startedAt, { ...summary, error: 'snapshot_warming' });
    return done({ status: 503, body: { error: 'snapshot_warming', detail: 'Market snapshot still building; the next run will use it' } });
  }

  if (ctx) {
    const deals = new Map<string, DealRow>();
    for (let i = 0; i < queue.length; i += 150) {
      const { data } = await admin.from('marketplace_deals').select(DEAL_COLUMNS).in('canonical_url', queue.slice(i, i + 150).map((r) => r.canonical_url));
      for (const d of (data ?? []) as unknown as DealRow[]) deals.set(d.canonical_url, d);
    }
    const listings = await loadSourcedListings(admin, queue.map((r) => r.canonical_url));
    let first = true;
    for (const item of queue) {
      if (elapsed() > TIME_BUDGET_MS) {
        summary.ranOutOfTime = true;
        break;
      }
      const deal = deals.get(item.canonical_url);
      const sourced = listings.get(item.canonical_url);
      if (!deal) continue;
      if (!sourced) {
        // The sourced row is gone (cascade would have removed the deal too); retire defensively.
        await retireDeal(admin, deal.canonical_url, 'removed', now);
        summary.retired.removed = (summary.retired.removed ?? 0) + 1;
        continue;
      }
      if (!first) await sleep(FETCH_GAP_MS);
      first = false;
      const res = await runMetered({ userId: null, admin: false, action: 'cron:marketplace-recheck', actionId: newActionId() }, () => fetchDealPage(deal));
      if (res === null) continue;
      summary.fetched += 1;
      const outcome = await applyLiveResult(admin, deal, sourced.listing, res, ctx, new Date());
      if (outcome.kind === 'paused') {
        summary.paused = true;
        break;
      }
      if (outcome.kind === 'live') summary.live += 1;
      else if (outcome.kind === 'retired') summary.retired[outcome.reason] = (summary.retired[outcome.reason] ?? 0) + 1;
      else summary.failed += 1;
    }
  }

  summary.ms = elapsed();
  await recordRun(admin, 'recheck', false, startedAt, summary);
  revalidateDeals();
  return done({ status: 200, body: summary });
}
