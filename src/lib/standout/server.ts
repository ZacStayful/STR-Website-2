import 'server-only';

/**
 * Batch 25: the reads and writes behind standout deals (supabase/schema.sql,
 * "Batch 25: standout-deal calls"). Service role only. Reads that fail answer
 * in the direction that saves nothing: an unreadable "already shown" set is
 * "shown", an unreadable member list is no members.
 */
import { createAdminClient } from '../supabase/admin';
import { CARD_COLUMNS } from '../marketplace/grid';
import { PAID_TIER_COLUMNS, hasEverPaid, type PaidTierAccount } from '../access';
import { isAdminEmail } from '../admin';
import { recordActivity } from '../activity/log';
import type { PoolRow } from '../today/candidates';

export type Admin = ReturnType<typeof createAdminClient>;

/** A deal as the standout judging reads it: Today's pool row, plus what the live check and the wording need. */
export const STANDOUT_DEAL_COLUMNS = `${CARD_COLUMNS}, deal, suitability, screening, project`;

export type StandoutDealRow = PoolRow & {
  project?: unknown;
  live_since?: string | null;
};

const PAGE = 1000;
const CHUNK = 150;

const chunks = <T,>(xs: readonly T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

/** Live deals that went live inside (from, to]. */
export async function liveDealsInWindow(admin: Admin, fromIso: string, toIso: string): Promise<StandoutDealRow[]> {
  if (Date.parse(toIso) <= Date.parse(fromIso)) return [];
  const out: StandoutDealRow[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await admin
      .from('marketplace_deals')
      .select(STANDOUT_DEAL_COLUMNS)
      .eq('status', 'live')
      .gt('live_since', fromIso)
      .lte('live_since', toIso)
      .order('live_since', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[standout] deals unreadable:', error.message);
      return out;
    }
    out.push(...((data ?? []) as unknown as StandoutDealRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

/** Deals by id (live only when asked; a deal shown earlier that has since gone still counts as "shown"). */
export async function dealRowsByIds(admin: Admin, ids: readonly string[], opts: { liveOnly?: boolean } = {}): Promise<StandoutDealRow[]> {
  const out: StandoutDealRow[] = [];
  for (const some of chunks([...new Set(ids)])) {
    let q = admin.from('marketplace_deals').select(STANDOUT_DEAL_COLUMNS).in('id', some);
    if (opts.liveOnly) q = q.eq('status', 'live');
    const { data, error } = await q;
    if (error) {
      console.error('[standout] deals by id unreadable:', error.message);
      continue;
    }
    out.push(...((data ?? []) as unknown as StandoutDealRow[]));
  }
  return out;
}

export interface StandoutMember {
  id: string;
  email: string | null;
  createdAt: string;
  /** Paid tier: hears the moment a deal goes live. Free: after the free delay. */
  paid: boolean;
  isTeamMember: boolean;
}

/** Every account, owners and team members alike (team members are skipped with a reason). */
export async function loadMembers(admin: Admin, onlyUserId: string | null = null): Promise<StandoutMember[]> {
  const rows: (PaidTierAccount & { id: string; email: string | null; created_at: string })[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    let q = admin.from('profiles').select(`id, email, created_at, ${PAID_TIER_COLUMNS}`).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (onlyUserId) q = q.eq('id', onlyUserId);
    const { data, error } = await q;
    if (error) {
      console.error('[standout] members unreadable:', error.message);
      return [];
    }
    rows.push(...((data ?? []) as unknown as typeof rows));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const team = new Set<string>();
  for (const some of chunks(rows.map((r) => r.id))) {
    const { data, error } = await admin.from('team_members').select('member_id').in('member_id', some);
    if (error) {
      // Unreadable: treat everyone as a team member, so nobody is saved or rung on a guess.
      console.error('[standout] team unreadable:', error.message);
      some.forEach((id) => team.add(id));
      continue;
    }
    for (const r of (data ?? []) as { member_id: string }[]) team.add(r.member_id);
  }
  return rows.map((r) => ({ id: r.id, email: r.email ?? null, createdAt: r.created_at, paid: hasEverPaid(r, { admin: isAdminEmail(r.email ?? null) }), isTeamMember: team.has(r.id) }));
}

/** Deals each free member's own search found (visible to them at once, Batch 22). */
export async function ownFindsFor(admin: Admin, userIds: readonly string[], dealIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const users of chunks(userIds)) {
    for (const deals of chunks(dealIds)) {
      const { data, error } = await admin.from('member_search_finds').select('user_id, deal_id').in('user_id', users).in('deal_id', deals);
      if (error) return out;
      for (const r of (data ?? []) as { user_id: string; deal_id: string }[]) out.set(r.user_id, new Set([...(out.get(r.user_id) ?? []), r.deal_id]));
    }
  }
  return out;
}

export interface ExistingDecision {
  id: string;
  userId: string;
  dealId: string;
  outcome: string;
  savedAt: string | null;
}

const decisionKey = (userId: string, dealId: string) => `${userId}:${dealId}`;

/** Every decision already made about these deals (any member), keyed user:deal. */
export async function existingDecisions(admin: Admin, dealIds: readonly string[]): Promise<Map<string, ExistingDecision> | null> {
  const out = new Map<string, ExistingDecision>();
  for (const some of chunks(dealIds)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from('standout_decisions').select('id, user_id, deal_id, outcome, saved_at').in('deal_id', some).range(from, from + PAGE - 1);
      if (error) {
        console.error('[standout] decisions unreadable (schema not run?):', error.message);
        return null;
      }
      for (const r of (data ?? []) as { id: string; user_id: string; deal_id: string; outcome: string; saved_at: string | null }[]) {
        out.set(decisionKey(r.user_id, r.deal_id), { id: r.id, userId: r.user_id, dealId: r.deal_id, outcome: r.outcome, savedAt: r.saved_at });
      }
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  return out;
}

export { decisionKey };

/** Decisions waiting on a live check, or saved-but-not-written (a retry): their deals are judged again. */
export async function retryDecisions(admin: Admin, now: Date): Promise<{ userId: string; dealId: string }[]> {
  const since = daysAgo(now, 3);
  const { data, error } = await admin
    .from('standout_decisions')
    .select('user_id, deal_id, outcome, saved_at')
    .not('deal_id', 'is', null)
    .gte('created_at', since)
    .or('outcome.eq.waiting,and(outcome.eq.standout,saved_at.is.null)')
    .limit(2000);
  if (error) return [];
  return ((data ?? []) as { user_id: string; deal_id: string }[]).map((r) => ({ userId: r.user_id, dealId: r.deal_id }));
}

/**
 * Deals a member has already met in any way: answered (Keep / Pass), opened,
 * picked, on any Today list, in their signup reveal, hidden from My deals.
 * A standout is always new to them. Unreadable: everything counts as seen.
 */
export async function seenDealsFor(admin: Admin, userIds: readonly string[], dealIds: readonly string[], now: Date): Promise<Map<string, Set<string>> | null> {
  const out = new Map<string, Set<string>>();
  const add = (u: string, d: string) => out.set(u, new Set([...(out.get(u) ?? []), d]));
  const wanted = new Set(dealIds);
  for (const users of chunks(userIds)) {
    for (const deals of chunks(dealIds)) {
      const reads = await Promise.all([
        admin.from('deal_reactions').select('user_id, deal_id').in('user_id', users).in('deal_id', deals),
        admin.from('deal_opens').select('user_id, deal_id').in('user_id', users).in('deal_id', deals),
        admin.from('sourcing_sent').select('user_id, deal_id').in('user_id', users).in('deal_id', deals),
        admin.from('hidden_tracked_deals').select('user_id, item_key').in('user_id', users).in('item_key', deals.map((d) => `d-${d}`)),
      ]);
      for (const r of reads) if (r.error) return null;
      for (const r of [reads[0], reads[1], reads[2]]) for (const row of (r.data ?? []) as { user_id: string; deal_id: string | null }[]) if (row.deal_id) add(row.user_id, row.deal_id);
      for (const row of (reads[3].data ?? []) as { user_id: string; item_key: string }[]) add(row.user_id, row.item_key.replace(/^d-/, ''));
    }
    const since = daysAgo(now, 90).slice(0, 10);
    const [lists, oldLists, reveals] = await Promise.all([
      admin.from('profile_today_lists').select('user_id, deal_ids, shown_ids').in('user_id', users).gte('day', since),
      admin.from('today_selections').select('user_id, deal_ids').in('user_id', users).gte('day', since),
      admin.from('signup_reveals').select('user_id, deal_ids, shown_ids, offer_deal_ids').in('user_id', users),
    ]);
    if (lists.error || oldLists.error || reveals.error) return null;
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    for (const r of (lists.data ?? []) as { user_id: string; deal_ids: unknown; shown_ids: unknown }[]) for (const d of [...ids(r.deal_ids), ...ids(r.shown_ids)]) if (wanted.has(d)) add(r.user_id, d);
    for (const r of (oldLists.data ?? []) as { user_id: string; deal_ids: unknown }[]) for (const d of ids(r.deal_ids)) if (wanted.has(d)) add(r.user_id, d);
    for (const r of (reveals.data ?? []) as { user_id: string; deal_ids: unknown; shown_ids: unknown; offer_deal_ids: unknown }[]) for (const d of [...ids(r.deal_ids), ...ids(r.shown_ids), ...ids(r.offer_deal_ids)]) if (wanted.has(d)) add(r.user_id, d);
  }
  return out;
}

/** The deals shown to a member in the last `days` (Today lists, picks, the reveal): what a standout must beat. */
export async function shownDealIdsFor(admin: Admin, userId: string, days: number, now: Date): Promise<string[]> {
  const since = daysAgo(now, days);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const [lists, sent, reveal] = await Promise.all([
    admin.from('profile_today_lists').select('deal_ids, shown_ids').eq('user_id', userId).gte('day', since.slice(0, 10)),
    admin.from('sourcing_sent').select('deal_id').eq('user_id', userId).gte('sent_at', since).not('deal_id', 'is', null),
    admin.from('signup_reveals').select('deal_ids, created_at').eq('user_id', userId).gte('created_at', since),
  ]);
  const out = new Set<string>();
  for (const r of (lists.data ?? []) as { deal_ids: unknown; shown_ids: unknown }[]) for (const d of [...ids(r.deal_ids), ...ids(r.shown_ids)]) out.add(d);
  for (const r of (sent.data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
  for (const r of (reveal.data ?? []) as { deal_ids: unknown }[]) for (const d of ids(r.deal_ids)) out.add(d);
  return [...out].slice(0, 400);
}

/** A member's standout saves in the last `days`: their match and profit (to beat), and how many today. */
export async function savesFor(admin: Admin, userIds: readonly string[], days: number, ukDay: string, now: Date): Promise<Map<string, { saved: { matchPct: number | null; profitLow: number | null }[]; today: number }>> {
  const out = new Map<string, { saved: { matchPct: number | null; profitLow: number | null }[]; today: number }>();
  const since = daysAgo(now, Math.max(days, 1));
  for (const users of chunks(userIds)) {
    const { data, error } = await admin.from('standout_decisions').select('user_id, uk_day, match_pct, profit_low_pcm').in('user_id', users).not('saved_at', 'is', null).gte('saved_at', since);
    if (error) continue;
    for (const r of (data ?? []) as { user_id: string; uk_day: string; match_pct: number | null; profit_low_pcm: number | null }[]) {
      const m = out.get(r.user_id) ?? { saved: [], today: 0 };
      m.saved.push({ matchPct: r.match_pct, profitLow: r.profit_low_pcm });
      if (r.uk_day === ukDay) m.today += 1;
      out.set(r.user_id, m);
    }
  }
  return out;
}

/** Each member's signup reveal #1 (the deal id), when they had a reveal. */
export async function revealTopsFor(admin: Admin, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const users of chunks(userIds)) {
    const { data, error } = await admin.from('signup_reveals').select('user_id, deal_ids').in('user_id', users);
    if (error) continue;
    for (const r of (data ?? []) as { user_id: string; deal_ids: unknown }[]) {
      const first = Array.isArray(r.deal_ids) ? r.deal_ids.find((x): x is string => typeof x === 'string') : undefined;
      if (first) out.set(r.user_id, first);
    }
  }
  return out;
}

export interface DecisionRow {
  user_id: string;
  profile_id: string | null;
  deal_id: string | null;
  deal_type: string | null;
  uk_day: string;
  tier: 'paid' | 'free';
  outcome: 'standout' | 'not_standout' | 'skipped' | 'waiting';
  reason: string;
  match_pct?: number | null;
  met?: number | null;
  checked?: number | null;
  reveal_pct?: number | null;
  profit_low_pcm?: number | null;
  profit_basis?: string | null;
  min_profit_pcm?: number | null;
  live_confirmed_at?: string | null;
  forced?: boolean;
}

/** Deal decisions: new ones written, a waiting one moved on (never a decided one twice). */
export async function writeDealDecisions(admin: Admin, rows: readonly DecisionRow[], existing: Map<string, ExistingDecision>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const fresh = rows.filter((r) => r.deal_id && !existing.has(decisionKey(r.user_id, r.deal_id)));
  // A waiting decision moves on; a forced test may overwrite any decision that saved nothing.
  const moving = rows.filter((r) => {
    const prev = r.deal_id ? existing.get(decisionKey(r.user_id, r.deal_id)) : undefined;
    return prev !== undefined && !prev.savedAt && (prev.outcome === 'waiting' || (r.forced === true && prev.outcome !== 'standout'));
  });
  for (const some of chunks(fresh, 200)) {
    const { data, error } = await admin.from('standout_decisions').upsert(some.map((r) => ({ ...r, forced: r.forced ?? false })), { onConflict: 'user_id,deal_id', ignoreDuplicates: true }).select('id, user_id, deal_id');
    if (error) {
      console.error('[standout] decisions write failed:', error.message);
      continue;
    }
    for (const r of (data ?? []) as { id: string; user_id: string; deal_id: string }[]) ids.set(decisionKey(r.user_id, r.deal_id), r.id);
  }
  for (const r of moving) {
    const prev = existing.get(decisionKey(r.user_id, r.deal_id!))!;
    const { data, error } = await admin.from('standout_decisions').update({ ...r, updated_at: new Date().toISOString() }).eq('id', prev.id).eq('outcome', prev.outcome).is('saved_at', null).select('id');
    if (error) console.error('[standout] decision update failed:', error.message);
    if ((data ?? []).length === 1) ids.set(decisionKey(r.user_id, r.deal_id!), prev.id);
  }
  // A standout decided but never written (a crashed save) is retried in place.
  for (const r of rows) {
    const prev = r.deal_id ? existing.get(decisionKey(r.user_id, r.deal_id)) : undefined;
    if (prev && prev.outcome === 'standout' && !prev.savedAt && r.outcome === 'standout') ids.set(decisionKey(r.user_id, r.deal_id!), prev.id);
  }
  return ids;
}

/** Member-level reasons, at most once per member, day and reason. */
export async function writeMemberDecisions(admin: Admin, rows: readonly DecisionRow[]): Promise<void> {
  for (const r of rows) {
    const { error } = await admin.from('standout_decisions').insert(r);
    if (error && error.code !== '23505') console.error('[standout] member decision failed:', error.message);
  }
}

export type SaveResult = 'saved' | 'already_saved' | 'answered' | 'error';

/**
 * Save a standout to the member's My deals: claim the decision once (saved_at
 * from null), then a Keep marked saved_by 'stayful_intelligence' on their
 * primary profile. A Keep or Pass the member already gave wins: nothing is
 * overwritten and the decision becomes "not new". Never twice, however many
 * passes run.
 */
export async function saveStandout(admin: Admin, s: { decisionId: string; userId: string; dealId: string; profileId: string | null; token: string; now: Date }): Promise<SaveResult> {
  const nowIso = s.now.toISOString();
  const { data: claimed, error } = await admin.from('standout_decisions').update({ saved_at: nowIso, link_token: s.token, updated_at: nowIso }).eq('id', s.decisionId).is('saved_at', null).eq('outcome', 'standout').select('id');
  if (error) {
    console.error('[standout] save claim failed:', error.message);
    return 'error';
  }
  if ((claimed ?? []).length !== 1) return 'already_saved';
  const { error: keepErr } = await admin.from('deal_reactions').insert({ user_id: s.userId, deal_id: s.dealId, reaction: 'keep', profile_id: s.profileId, saved_by: 'stayful_intelligence' });
  if (keepErr) {
    if (keepErr.code === '23505') {
      // The member answered it in the meantime: their answer stands.
      await admin.from('standout_decisions').update({ outcome: 'not_standout', reason: 'not_new', saved_at: null, link_token: null, updated_at: nowIso }).eq('id', s.decisionId);
      return 'answered';
    }
    console.error('[standout] keep write failed:', keepErr.message);
    // Give the claim back: the next pass retries the save.
    await admin.from('standout_decisions').update({ saved_at: null, link_token: null, updated_at: nowIso }).eq('id', s.decisionId);
    return 'error';
  }
  await recordActivity(s.userId, 'si_auto_saved', { dealId: s.dealId, profileId: s.profileId, source: 'system', dedupeKey: `si_auto_saved:${s.dealId}` });
  return 'saved';
}

/** The last finished pass's watermarks. */
export async function lastRun(admin: Admin): Promise<{ paidThrough: string | null; freeThrough: string | null } | null> {
  const { data, error } = await admin.from('standout_runs').select('paid_through, free_through').not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1);
  if (error) {
    console.error('[standout] runs unreadable (schema not run?):', error.message);
    return null;
  }
  const r = ((data ?? [])[0] as { paid_through: string | null; free_through: string | null } | undefined) ?? null;
  return { paidThrough: r?.paid_through ?? null, freeThrough: r?.free_through ?? null };
}

export async function recordRun(admin: Admin, r: { kind: 'cron' | 'admin'; startedAt: Date; paidThrough: string; freeThrough: string; summary: Record<string, unknown> }): Promise<void> {
  const { error } = await admin.from('standout_runs').insert({ kind: r.kind, started_at: r.startedAt.toISOString(), finished_at: new Date().toISOString(), paid_through: r.paidThrough, free_through: r.freeThrough, summary: r.summary });
  if (error) console.error('[standout] run record failed:', error.message);
}

/** Not-standout decisions older than keepDays go; standouts (and anything saved) stay. Once a UK day is enough. */
export async function purgeOldDecisions(admin: Admin, keepDays: number, now: Date): Promise<number> {
  const { data, error } = await admin.from('standout_decisions').delete().lt('created_at', daysAgo(now, keepDays)).in('outcome', ['not_standout', 'skipped']).is('saved_at', null).select('id');
  if (error) {
    console.error('[standout] purge failed:', error.message);
    return 0;
  }
  return (data ?? []).length;
}
