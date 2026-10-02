import 'server-only';

/**
 * Batch 22e: Home's reads. Every tile is read in parallel and settled on its
 * own, so one that cannot be read shows "—" and the rest still render.
 *
 * Read-only, and never a charge: Today's 5 is read back from the stored list
 * (never chosen here — choosing can charge), deals and opens are counted,
 * never opened. The one write is the member's scan baseline, stored once
 * after their joining day (public.member_scanned).
 *
 * Team members see their own figures; "Total spent" is not shown to them
 * (credit is the owner's and cannot be split per person).
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { teamOf } from '../team';
import { profilesFor, latestRestartsFor } from '../profiles/server';
import { isRunning, type SavedProfile } from '../profiles/rules';
import { tailoringForSeats } from '../tailoring/server';
import { wantsFor } from '../tailoring/criteria';
import { kindsOf } from '../sourcing-demand/demand';
import { DEFAULT_GOALS } from '../market/goals';
import { areaMetaForCode } from '../market/areas';
import { todayKey } from '../today/day';
import { todaysPick } from '../today/selection';
import { reactionsFor } from '../marketplace/reactions-server';
import { loadTrackedDeals } from '../listing/tracked-server';
import { profileTagsFor } from '../profiles/deal-tags';
import { revealRowFor } from '../intelligence/reveal-server';
import { usageLinesSince } from '../credit/usage-server';
import { ukDay } from '../activity/week';
import { memberScanTotal, type ScanKind } from './scan-days';
import { SAVED_DEALS_READ, analysesFigure, pickedCounts, savedStageCounts, settle, spentPence, timeSavedFigure, todayFigure, type PickedList } from './figures';
import { buildFeed, feedFrom, type FeedDay, type FeedEvent } from './feed';
import { dealIdsInSend, emailedDates, type AlertRow, type SendRow } from './emailed';
import type { AnalysesFigure, FeedItem, HomeFigures, PickedFigure, SavedFigure, ScannedFigure, SpentFigure, TodayFigure } from './types';

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const MAX_ROWS = 20_000;

/** Every row of a read, a page at a time (PostgREST stops at 1000). */
async function paged<T>(what: string, read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error(`${what}: more than ${MAX_ROWS} rows`);
}

async function exactCount(what: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  return count ?? 0;
}

// ── Who is looking ──

export interface HomeMember {
  userId: string;
  /** auth.users created_at: when they joined. */
  joinedAt: string;
}

interface Context {
  admin: Admin;
  member: HomeMember;
  now: Date;
  live: SavedProfile[];
  active: SavedProfile | null;
  teamMember: boolean;
  payerId: string;
  /** Someone else shares this account (an owner with members, or a member). */
  sharedAccount: boolean;
}

async function contextFor(member: HomeMember, now: Date): Promise<Context> {
  const admin = createAdminClient();
  const [view, team] = await Promise.all([profilesFor(member.userId), teamOf(member.userId)]);
  let sharedAccount = team.role === 'member';
  if (!sharedAccount) {
    const { count } = await admin.from('team_members').select('member_id', { count: 'exact', head: true }).eq('owner_id', member.userId);
    sharedAccount = (count ?? 0) > 0;
  }
  return { admin, member, now, live: view.readable ? view.live : [], active: view.readable ? view.active : null, teamMember: team.role === 'member', payerId: team.ownerId, sharedAccount };
}

// ── Properties scanned (Part C) ──

/** Every live profile's areas (Batch 14) and kinds (Batch 17); none, or any profile with no area limit, means every area. */
async function scanScopeFor(ctx: Context): Promise<{ areas: string[] | null; kinds: ScanKind[] }> {
  if (ctx.live.length === 0) return { areas: null, kinds: ['sale', 'rent'] };
  const seats = ctx.live.map((p) => ({ userId: ctx.member.userId, profile: p, goals: p.goals, savedAreas: p.areas }));
  const tailored = await tailoringForSeats(ctx.admin, seats, ctx.now);
  let areas: Set<string> | null = new Set();
  const kinds = new Set<ScanKind>();
  for (const t of tailored.values()) {
    const w = wantsFor(t);
    if (w.areas === null) areas = null;
    else if (areas) for (const a of w.areas) areas.add(a.toUpperCase());
    for (const k of kindsOf(t.goals ?? DEFAULT_GOALS, t.about.roles)) kinds.add(k);
  }
  if (kinds.size === 0) kinds.add('sale').add('rent');
  return { areas: areas ? [...areas].sort() : null, kinds: [...kinds] };
}

/** Batch 23b's nightly snapshot reads this too: the one "scanned" figure. */
export async function memberScanned(member: HomeMember, now: Date = new Date()): Promise<ScannedFigure> {
  if (!hasServiceRole()) throw new Error('no service role');
  return scannedFor(await contextFor(member, now));
}

async function scannedFor(ctx: Context): Promise<ScannedFigure> {
  const joinDay = ukDay(new Date(ctx.member.joinedAt));
  const [scope, reveal, first] = await Promise.all([
    scanScopeFor(ctx),
    revealRowFor(ctx.member.userId),
    ctx.admin.from('sourced_listings').select('first_seen_at').order('first_seen_at', { ascending: true }).limit(1),
  ]);
  const { data, error } = await ctx.admin.rpc('member_scanned', { p: { user: ctx.member.userId, join_day: joinDay, today: ukDay(ctx.now), areas: scope.areas, kinds: scope.kinds } });
  if (error) throw new Error(`member_scanned: ${error.message}`);
  const r = (data ?? {}) as { baseline?: number; new_since?: number };
  const t = memberScanTotal(r.baseline, reveal?.checked ?? null, r.new_since);
  const firstAt = ((first.data ?? []) as { first_seen_at: string }[])[0]?.first_seen_at;
  const firstDay = firstAt ? ukDay(new Date(firstAt)) : null;
  return { ...t, joinDay, countedFrom: firstDay && firstDay > joinDay ? firstDay : null, areas: scope.areas === null ? 'all' : scope.areas.length };
}

// ── Today's 5 ──

async function todayFor(ctx: Context): Promise<TodayFigure> {
  const day = todayKey(ctx.now);
  const active = ctx.active;
  const paused = active ? !isRunning(active) : false;
  if (paused) return todayFigure({ day, stored: null, pickDealId: null, answers: new Map(), paused, profileName: active?.name ?? null });
  const listRead = active
    ? ctx.admin.from('profile_today_lists').select('deal_ids').eq('profile_id', active.id).eq('day', day).maybeSingle()
    : ctx.admin.from('today_selections').select('deal_ids').eq('user_id', ctx.member.userId).eq('day', day).maybeSingle();
  const [list, pick] = await Promise.all([listRead, todaysPick(ctx.member.userId, ctx.now, active?.id ?? null)]);
  if (list.error) throw new Error(`today list: ${list.error.message}`);
  const stored = list.data ? ((list.data as { deal_ids: string[] | null }).deal_ids ?? []) : null;
  const ids = [...new Set([...(pick?.dealId ? [pick.dealId] : []), ...(stored ?? [])])];
  const reactions = await reactionsFor(ctx.member.userId, ids);
  const answers = new Map<string, 'keep' | 'pass'>();
  for (const [id, r] of reactions) if (r === 'keep' || r === 'pass') answers.set(id, r);
  return todayFigure({ day, stored, pickDealId: pick?.dealId ?? null, answers, paused: false, profileName: ctx.live.length > 1 ? active?.name ?? null : null });
}

// ── Deals picked for you ──

async function pickedFor(ctx: Context): Promise<PickedFigure> {
  const uid = ctx.member.userId;
  const [lists, legacy, reveal, restarts] = await Promise.all([
    paged<{ profile_id: string | null; created_at: string | null; deal_ids: string[] | null }>('profile lists', (from, to) => ctx.admin.from('profile_today_lists').select('profile_id, created_at, deal_ids').eq('user_id', uid).order('day', { ascending: true }).range(from, to)),
    paged<{ created_at: string | null; deal_ids: string[] | null }>('member lists', (from, to) => ctx.admin.from('today_selections').select('created_at, deal_ids').eq('user_id', uid).order('day', { ascending: true }).range(from, to)),
    revealRowFor(uid),
    ctx.active ? latestRestartsFor(ctx.admin, [ctx.active.id], new Date(0)) : Promise.resolve(new Map<string, string>()),
  ]);
  const all: PickedList[] = [
    ...lists.map((l) => ({ profileId: l.profile_id, at: l.created_at, dealIds: l.deal_ids ?? [] })),
    ...legacy.map((l) => ({ profileId: null, at: l.created_at, dealIds: l.deal_ids ?? [] })),
    ...(reveal ? [{ profileId: reveal.profileId, at: `${reveal.day}T07:00:00Z`, dealIds: reveal.dealIds }] : []),
  ];
  const restartAt = ctx.active ? restarts.get(ctx.active.id) ?? null : null;
  const counts = pickedCounts(all, ctx.active?.id ?? null, restartAt);
  return { active: ctx.live.length > 1 || restartAt ? counts.active : null, all: counts.all };
}

// ── Saved deals ──

async function savedFor(ctx: Context): Promise<SavedFigure> {
  const load = await loadTrackedDeals(ctx.member.userId, SAVED_DEALS_READ);
  const all = savedStageCounts(load.view);
  if (ctx.live.length < 2 || !ctx.active) return { all, active: null, activeProfileId: ctx.active?.id ?? null };
  const tags = await profileTagsFor(ctx.member.userId, load.payerId, load.view);
  return { all, active: savedStageCounts(load.view, tags, ctx.active.id), activeProfileId: ctx.active.id };
}

// ── Analyses ──

async function analysesFor(ctx: Context): Promise<AnalysesFigure> {
  const uid = ctx.member.userId;
  const quickRead = ctx.sharedAccount
    ? // On a shared account the opens are the payer's: the member's own are in the activity log.
      exactCount('quick looks', ctx.admin.from('activity_events').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('kind', 'deal_open'))
    : exactCount('quick looks', ctx.admin.from('deal_opens').select('deal_id', { count: 'exact', head: true }).eq('user_id', uid).or('verified_via.is.null,verified_via.neq.pick'));
  const [reports, deepAnalyses, quickLooks] = await Promise.all([
    exactCount('reports', ctx.admin.from('saved_searches').select('id', { count: 'exact', head: true }).eq('user_id', uid)),
    exactCount('full analyses', ctx.admin.from('analysis_purchases').select('id', { count: 'exact', head: true }).eq('buyer_id', uid).eq('kind', 'full_analysis').eq('status', 'complete')),
    quickRead,
  ]);
  return analysesFigure({ reports, deepAnalyses, quickLooks });
}

// ── Total spent ──

async function spentFor(ctx: Context): Promise<SpentFigure> {
  const { lines, truncated, failed } = await usageLinesSince(ctx.member.userId, new Date(ctx.member.joinedAt));
  if (failed || truncated) throw new Error('ledger unreadable');
  return { pence: spentPence(lines) };
}

// ── This week ──

async function feedFor(ctx: Context): Promise<FeedItem[]> {
  const uid = ctx.member.userId;
  const from = feedFrom(ctx.now);
  const fromIso = new Date(`${from}T00:00:00Z`).getTime() - 2 * 3600_000; // UK midnight is at most an hour before UTC midnight
  const since = new Date(fromIso).toISOString();
  const scope = await scanScopeFor(ctx);
  const [scan, lists, sends, alerts, analyses, reports] = await Promise.all([
    paged<{ day: string; postcode_area: string; new_listings: number }>('scan days', (f, t) => {
      let q = ctx.admin.from('listing_scan_days').select('day, postcode_area, new_listings').gte('day', from).in('kind', scope.kinds);
      if (scope.areas) q = q.in('postcode_area', scope.areas.length > 0 ? scope.areas : ['-']);
      return q.order('day', { ascending: true }).order('postcode_area', { ascending: true }).range(f, t);
    }),
    paged<{ day: string; deal_ids: string[] | null }>('lists', (f, t) => ctx.admin.from('profile_today_lists').select('day, deal_ids').eq('user_id', uid).gte('day', from).range(f, t)),
    paged<{ day: string; summary: unknown }>('sends', (f, t) => ctx.admin.from('notification_sends').select('day, summary').eq('user_id', uid).eq('status', 'sent').gte('day', from).range(f, t)),
    paged<{ alert_type: string; deal_id: string | null; notified_at: string }>('alerts', (f, t) => ctx.admin.from('deal_alerts').select('alert_type, deal_id, notified_at').eq('user_id', uid).gte('notified_at', since).not('notified_at', 'is', null).range(f, t)),
    paged<{ completed_at: string | null; deal_id: string | null }>('analyses', (f, t) => ctx.admin.from('analysis_purchases').select('completed_at, deal_id').eq('buyer_id', uid).eq('kind', 'full_analysis').eq('status', 'complete').gte('completed_at', since).range(f, t)),
    paged<{ created_at: string }>('reports', (f, t) => ctx.admin.from('saved_searches').select('created_at').eq('user_id', uid).gte('created_at', since).range(f, t)),
  ]);
  const days = new Map<string, FeedDay>();
  const dayOf = (d: string) => days.get(d) ?? days.set(d, { day: d, screened: 0, picked: 0, emailed: 0 }).get(d)!;
  for (const r of scan) dayOf(String(r.day)).screened += r.new_listings;
  for (const l of lists) dayOf(String(l.day)).picked += (l.deal_ids ?? []).length;
  for (const s of sends) dayOf(String(s.day)).emailed += dealIdsInSend(s.summary).length;

  const dealIds = [...new Set(alerts.map((a) => a.deal_id).filter((x): x is string => Boolean(x)))];
  const areaOf = new Map<string, string | null>();
  if (dealIds.length > 0) {
    const { data } = await ctx.admin.from('marketplace_deals').select('id, postcode_area').in('id', dealIds);
    for (const d of (data ?? []) as { id: string; postcode_area: string | null }[]) areaOf.set(d.id, d.postcode_area);
  }
  const alertKinds = new Set(['price_drop', 'back_on_market', 'nearly_gone', 'gone']);
  const events: FeedEvent[] = [
    ...alerts
      .filter((a) => alertKinds.has(a.alert_type))
      .map((a) => {
        const area = a.deal_id ? areaOf.get(a.deal_id) ?? null : null;
        return { at: a.notified_at, kind: a.alert_type as FeedEvent['kind'], area, areaName: area ? areaMetaForCode(area).name : null, dealId: a.deal_id };
      }),
    ...analyses.filter((a) => a.completed_at).map((a) => ({ at: a.completed_at!, kind: 'analysis' as const, area: null, areaName: null, dealId: a.deal_id })),
    ...reports.map((r) => ({ at: r.created_at, kind: 'report' as const, area: null, areaName: null, dealId: null })),
  ];
  return buildFeed([...days.values()].filter((d) => d.day >= from), events, ctx.now);
}

// ── Everything ──

export async function loadHomeFigures(member: HomeMember, now: Date = new Date()): Promise<HomeFigures> {
  const failed = { ok: false } as const;
  if (!hasServiceRole()) return { today: failed, scanned: failed, timeSaved: failed, picked: failed, saved: failed, analyses: failed, spent: failed, feed: failed };
  const ctxTile = await settle(() => contextFor(member, now));
  if (!ctxTile.ok) return { today: failed, scanned: failed, timeSaved: failed, picked: failed, saved: failed, analyses: failed, spent: failed, feed: failed };
  const ctx = ctxTile.value;
  const [today, scanned, picked, saved, analyses, spent, feed] = await Promise.all([
    settle(() => todayFor(ctx)),
    settle(() => scannedFor(ctx)),
    settle(() => pickedFor(ctx)),
    settle(() => savedFor(ctx)),
    settle(() => analysesFor(ctx)),
    ctx.teamMember ? Promise.resolve(null) : settle(() => spentFor(ctx)),
    settle(() => feedFor(ctx)),
  ]);
  return { today, scanned, timeSaved: timeSavedFigure(scanned, analyses), picked, saved, analyses, spent, feed };
}

// ── "Emailed <date>" on Browse (Part D) ──

/** The latest date each deal was emailed to this member (a daily email or an alert email that went). Empty on any failure. */
export async function emailedDealDates(userId: string, dealIds: readonly string[]): Promise<Map<string, string>> {
  if (!hasServiceRole() || dealIds.length === 0) return new Map();
  try {
    const admin = createAdminClient();
    // Live deals are recent: 120 days of sends covers any card Browse can show.
    const since = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
    const [sends, alerts] = await Promise.all([
      paged<{ id: string; status: string; sent_at: string | null; day: string | null; summary: unknown }>('sends', (f, t) => admin.from('notification_sends').select('id, status, sent_at, day, summary').eq('user_id', userId).eq('status', 'sent').gte('day', since).range(f, t)),
      paged<{ deal_id: string | null; send_id: string | null; notified_at: string | null }>('alerts', (f, t) => admin.from('deal_alerts').select('deal_id, send_id, notified_at').eq('user_id', userId).in('deal_id', [...dealIds]).not('notified_at', 'is', null).range(f, t)),
    ]);
    const sendRows: SendRow[] = sends.map((s) => ({ id: s.id, status: s.status, sentAt: s.sent_at, day: s.day, summary: s.summary }));
    // An alert's send may be older than the window: read those sends too.
    const known = new Set(sendRows.map((s) => s.id));
    const missing = [...new Set(alerts.map((a) => a.send_id).filter((x): x is string => Boolean(x) && !known.has(x!)))];
    if (missing.length > 0) {
      const { data } = await admin.from('notification_sends').select('id, status, sent_at, day').eq('user_id', userId).in('id', missing);
      for (const s of (data ?? []) as { id: string; status: string; sent_at: string | null; day: string | null }[]) sendRows.push({ id: s.id, status: s.status, sentAt: s.sent_at, day: s.day, summary: null });
    }
    const alertRows: AlertRow[] = alerts.map((a) => ({ dealId: a.deal_id, sendId: a.send_id, notifiedAt: a.notified_at }));
    return emailedDates(dealIds, sendRows, alertRows);
  } catch (err) {
    console.warn('[home] emailed dates failed:', err instanceof Error ? err.message : String(err));
    return new Map();
  }
}
