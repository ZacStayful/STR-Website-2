import 'server-only';

/**
 * What buy-to-let is doing, for /admin/deals/btl (Batch 28, Part J): the
 * members who chose it (by priority and cash band), the deals shown, opened
 * and kept this week with the keep rate against the other types, the £2
 * reports and their revenue, how often a day had to look beyond the member's
 * areas, the paid shortlist's spend today against its cap, and the live
 * buy-to-let deals by cash band and rent confidence.
 *
 * Member figures leave out the accounts every weekly-active figure leaves
 * out (metricsExcludedIds: admin, staff, "Exclude from metrics"). Members are
 * counted, never named, and no deal is named. Every read is tolerant: a
 * table or column the database does not have yet reads as "no figure".
 */
import type { createAdminClient } from '../supabase/admin';
import { metricsExcludedIds } from '../activity/admin-server';
import { ukWeekStart, ukWeekRange } from '../activity/week';
import { ukDayStart } from '../deal-quality/checks';
import { GOAL_OPTIONS, parseMarketGoals, type DealType, type MarketGoals } from '../market/goals';
import type { TypedDeal } from '../profile/deal-types';
import { parseBtlCard } from './card';
import { readBtlSettings } from './settings-server';
import { dayUse } from './screen-server';
import { emptyFunnel, profileTypes, shownAs, tallyLists, type FunnelByType, type ListRow, type WidenTally } from './admin';

type Admin = ReturnType<typeof createAdminClient>;
type DbError = { code?: string; message?: string } | null;

const CHUNK = 150;
const PAGE = 1000;
const MAX_ROWS = 50_000;

const warn = (what: string, error: DbError) => {
  if (error && !/does not exist|could not find|42703|42P01/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) console.warn(`[btl-admin] ${what} unreadable:`, error.message);
};

/** Every row of a read, a page at a time; null when it fails. */
async function paged<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>, what: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) {
      warn(what, error);
      return null;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Rows for these ids, a chunk at a time (PostgREST's URL length); null when it fails. */
async function inChunks<T>(ids: readonly string[], read: (some: string[]) => PromiseLike<{ data: unknown; error: DbError }>, what: string): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) {
      warn(what, error);
      return null;
    }
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export interface BtlMembers {
  /** Members (not excluded) with at least one profile showing Buy to let. */
  members: number;
  profiles: number;
  byPriority: Record<string, number>;
  byBand: Record<string, number>;
  /** Members with a profile and no Buy to let: who the launch can still reach. */
  without: number;
}

export interface BtlReports {
  week: number;
  weekPence: number;
  month: number;
  monthPence: number;
  /** Charged nothing: the run failed. */
  failedMonth: number;
  welcomeMonth: number;
}

export interface BtlSpend {
  pence: number;
  valuations: number;
  capPence: number;
  capValuations: number;
}

export interface BtlLive {
  total: number;
  /** Also a short-let deal (band qualified). */
  alsoShortLet: number;
  byBand: Record<string, number>;
  byConfidence: Record<string, number>;
  /** Rent narrowed by a PropertyData valuation. */
  valued: number;
}

export interface BtlAdminView {
  weekStart: string;
  members: BtlMembers | null;
  funnel: FunnelByType | null;
  widen: WidenTally | null;
  reports: BtlReports | null;
  spend: BtlSpend;
  live: BtlLive | null;
  activity: { explorerToggles: number; reportsRun: number; btlAnswers: number; dealTypeEdits: number } | null;
  launch: { from: string | null; sent: number | null };
  excluded: number;
}

type ProfileDb = { id: string; user_id: string; criteria: unknown };
type ListDb = { profile_id: string; user_id: string; deal_ids: string[] | null; shown_ids?: string[] | null; choice?: unknown };
type DealDb = { id: string; kind: 'sale' | 'rent'; band: string | null; btl_pass?: boolean | null; project?: unknown };

export async function btlAdminView(admin: Admin, now: Date = new Date()): Promise<BtlAdminView> {
  const weekStart = ukWeekStart(now);
  const since = ukWeekRange(weekStart).start.toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { settings } = await readBtlSettings(admin);

  const [profileRows, listRows, openRows, reactionRows, siSavedRows, purchaseRows, activityRows, spend, liveRows, launchRes] = await Promise.all([
    paged<ProfileDb>((a, b) => admin.from('search_profiles').select('id, user_id, criteria').is('deleted_at', null).order('id').range(a, b), 'profiles'),
    paged<ListDb>(
      (a, b) => admin.from('profile_today_lists').select('profile_id, user_id, deal_ids, shown_ids, choice').gte('day', weekStart).order('profile_id').range(a, b),
      'Today lists',
    ).then(async (rows) => rows ?? (await paged<ListDb>((a, b) => admin.from('profile_today_lists').select('profile_id, user_id, deal_ids').gte('day', weekStart).order('profile_id').range(a, b), 'Today lists'))),
    paged<{ user_id: string; deal_id: string; profile_id: string | null }>((a, b) => admin.from('deal_opens').select('user_id, deal_id, profile_id').eq('status', 'open').gte('opened_at', since).order('opened_at').range(a, b), 'opens'),
    paged<{ user_id: string; deal_id: string; profile_id: string | null; reaction: string }>((a, b) => admin.from('deal_reactions').select('user_id, deal_id, profile_id, reaction').gte('updated_at', since).order('updated_at').range(a, b), 'reactions'),
    // Batch 25: Keeps Stayful Intelligence made are not members' answers.
    paged<{ user_id: string; deal_id: string }>((a, b) => admin.from('deal_reactions').select('user_id, deal_id').not('saved_by', 'is', null).gte('updated_at', since).order('updated_at').range(a, b), 'saved Keeps'),
    paged<{ buyer_id: string | null; user_id: string; status: string; offer: string | null; charged_base_pence: unknown; created_at: string }>(
      (a, b) => admin.from('analysis_purchases').select('buyer_id, user_id, status, offer, charged_base_pence, created_at').eq('kind', 'btl_report').gte('created_at', monthAgo).order('created_at').range(a, b),
      'reports',
    ),
    paged<{ user_id: string; kind: string; extras: Record<string, unknown> | null }>(
      (a, b) => admin.from('activity_events').select('user_id, kind, extras').in('kind', ['explorer_btl_toggle', 'report_run', 'profile_edited', 'profile_answered', 'profile_not_sure']).gte('occurred_at', since).order('occurred_at').range(a, b),
      'activity',
    ),
    dayUse(admin, ukDayStart(now)),
    paged<{ band: string | null; btl: unknown }>((a, b) => admin.from('marketplace_deals').select('band, btl').eq('status', 'live').eq('btl_pass', true).order('id').range(a, b), 'live buy-to-let deals'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).not('btl_launch_line_at', 'is', null),
  ]);

  // ── Who is left out of every member figure ──
  const everyone = new Set<string>();
  for (const r of profileRows ?? []) everyone.add(r.user_id);
  for (const r of listRows ?? []) everyone.add(r.user_id);
  for (const r of openRows ?? []) everyone.add(r.user_id);
  for (const r of reactionRows ?? []) everyone.add(r.user_id);
  for (const r of purchaseRows ?? []) everyone.add(r.buyer_id ?? r.user_id);
  const excluded = await metricsExcludedIds([...everyone]);
  const counted = (userId: string | null | undefined) => Boolean(userId) && !excluded.has(userId!);

  // ── Members by priority and cash band ──
  const goalsOf = new Map<string, MarketGoals | null>();
  const profilesOf = new Map<string, string[]>();
  for (const r of profileRows ?? []) {
    goalsOf.set(r.id, parseMarketGoals(r.criteria));
    profilesOf.set(r.user_id, [...(profilesOf.get(r.user_id) ?? []), r.id]);
  }
  let members: BtlMembers | null = null;
  if (profileRows) {
    const byPriority: Record<string, number> = Object.fromEntries([...GOAL_OPTIONS.btlPriority, 'unanswered'].map((k) => [k, 0]));
    const byBand: Record<string, number> = Object.fromEntries([...GOAL_OPTIONS.btlCash, 'unanswered'].map((k) => [k, 0]));
    const withBtl = new Set<string>();
    let profiles = 0;
    for (const r of profileRows) {
      if (!counted(r.user_id)) continue;
      const g = goalsOf.get(r.id) ?? null;
      if (!(g?.dealTypes ?? []).includes('btl')) continue;
      profiles += 1;
      withBtl.add(r.user_id);
      byPriority[g?.btl?.priority ?? 'unanswered'] += 1;
      byBand[g?.btl?.cashBand ?? 'unanswered'] += 1;
    }
    const all = new Set(profileRows.filter((r) => counted(r.user_id)).map((r) => r.user_id));
    members = { members: withBtl.size, profiles, byPriority, byBand, without: all.size - withBtl.size };
  }

  // The types each profile is shown; a row without one reads as the member's first profile.
  const typesOfProfile = (profileId: string | null | undefined, userId: string): readonly DealType[] => {
    const id = profileId && goalsOf.has(profileId) ? profileId : profilesOf.get(userId)?.[0] ?? null;
    return profileTypes(id ? goalsOf.get(id) ?? null : null);
  };

  // ── The deals behind the funnel, with their lenses ──
  const siSaved = new Set((siSavedRows ?? []).map((r) => `${r.user_id}:${r.deal_id}`));
  const lists = (listRows ?? []).filter((r) => counted(r.user_id));
  const opens = (openRows ?? []).filter((r) => counted(r.user_id));
  const reactions = (reactionRows ?? []).filter((r) => counted(r.user_id) && !siSaved.has(`${r.user_id}:${r.deal_id}`));
  const dealIds = new Set<string>();
  for (const l of lists) for (const id of [...(l.deal_ids ?? []), ...(l.shown_ids ?? [])]) dealIds.add(id);
  for (const o of opens) dealIds.add(o.deal_id);
  for (const r of reactions) dealIds.add(r.deal_id);
  const ids = [...dealIds];
  const dealRows =
    (await inChunks<DealDb>(ids, (some) => admin.from('marketplace_deals').select('id, kind, band, btl_pass, project').in('id', some), 'deal lenses')) ??
    // Before the Batch 28 section: no deal is a buy-to-let deal yet.
    (await inChunks<DealDb>(ids, (some) => admin.from('marketplace_deals').select('id, kind, band, project').in('id', some), 'deal lenses'));
  const deals = new Map<string, TypedDeal>((dealRows ?? []).map((d) => [d.id, { kind: d.kind, band: d.band ?? undefined, project: d.project ?? null, btl_pass: d.btl_pass === true }]));

  let funnel: FunnelByType | null = null;
  let widen: WidenTally | null = null;
  if (dealRows) {
    const listInput: ListRow[] = lists.map((l) => ({ profileId: l.profile_id, dealIds: l.deal_ids ?? [], shownIds: l.shown_ids ?? null, choice: l.choice }));
    const userOfProfile = new Map(lists.map((l) => [l.profile_id, l.user_id]));
    const tallied = listRows ? tallyLists(listInput, deals, (pid) => typesOfProfile(pid, userOfProfile.get(pid) ?? ''), emptyFunnel()) : { funnel: emptyFunnel(), widen: null };
    funnel = tallied.funnel;
    widen = tallied.widen;
    if (openRows) {
      for (const o of opens) {
        const t = shownAs(deals.get(o.deal_id), typesOfProfile(o.profile_id, o.user_id));
        if (t) funnel[t].opened += 1;
      }
    }
    if (reactionRows) {
      for (const r of reactions) {
        const t = shownAs(deals.get(r.deal_id), typesOfProfile(r.profile_id, r.user_id));
        if (!t) continue;
        if (r.reaction === 'keep') funnel[t].keeps += 1;
        else if (r.reaction === 'pass') funnel[t].passes += 1;
      }
    }
  }

  // ── £2 reports and their revenue (charged only once made) ──
  let reports: BtlReports | null = null;
  if (purchaseRows) {
    reports = { week: 0, weekPence: 0, month: 0, monthPence: 0, failedMonth: 0, welcomeMonth: 0 };
    for (const p of purchaseRows) {
      if (!counted(p.buyer_id ?? p.user_id)) continue;
      if (p.status === 'failed') {
        reports.failedMonth += 1;
        continue;
      }
      if (p.status !== 'complete') continue;
      const pence = Number(p.charged_base_pence) || 0;
      reports.month += 1;
      reports.monthPence += pence;
      if (p.offer === 'welcome_btl') reports.welcomeMonth += 1;
      if (p.created_at >= since) {
        reports.week += 1;
        reports.weekPence += pence;
      }
    }
  }

  // ── Activity this week ──
  let activity: BtlAdminView['activity'] = null;
  if (activityRows) {
    activity = { explorerToggles: 0, reportsRun: 0, btlAnswers: 0, dealTypeEdits: 0 };
    for (const a of activityRows) {
      if (!counted(a.user_id)) continue;
      const q = a.extras?.question;
      if (a.kind === 'explorer_btl_toggle') activity.explorerToggles += 1;
      else if (a.kind === 'report_run' && a.extras?.type === 'btl') activity.reportsRun += 1;
      // First answers (profile_answered / profile_not_sure, as every quiz question logs) and changes (profile_edited).
      else if ((q === 'btl_priority' || q === 'btl_cash') && a.kind.startsWith('profile_')) activity.btlAnswers += 1;
      else if (a.kind === 'profile_edited' && q === 'deal_types') activity.dealTypeEdits += 1;
    }
  }

  // ── Live buy-to-let deals by cash band and rent confidence ──
  let live: BtlLive | null = null;
  if (liveRows) {
    live = { total: 0, alsoShortLet: 0, byBand: {}, byConfidence: {}, valued: 0 };
    for (const r of liveRows) {
      live.total += 1;
      if (r.band === 'qualified') live.alsoShortLet += 1;
      const card = parseBtlCard(r.btl);
      const band = card?.band ?? 'unknown';
      const conf = card?.rent.confidence ?? 'unknown';
      live.byBand[band] = (live.byBand[band] ?? 0) + 1;
      live.byConfidence[conf] = (live.byConfidence[conf] ?? 0) + 1;
      if (card?.rent.valuation != null) live.valued += 1;
    }
  }

  if (launchRes.error) warn('launch line', launchRes.error);

  return {
    weekStart,
    members,
    funnel,
    widen,
    reports,
    spend: { pence: Number.isFinite(spend.pence) ? Math.round(spend.pence * 100) / 100 : -1, valuations: Number.isFinite(spend.valuations) ? spend.valuations : -1, capPence: settings.allowance.capPence, capValuations: settings.allowance.valuations },
    live,
    activity,
    launch: { from: settings.launchFrom, sent: launchRes.error ? null : launchRes.count ?? 0 },
    excluded: excluded.size,
  };
}
