import 'server-only';

/**
 * Batch 25, Part B: what an SI save means everywhere else.
 *
 *   label        "Saved for you by Stayful Intelligence" on the My deals card
 *                until the member opens it or moves its stage
 *   free open    opening a deal saved for the account costs nothing (only
 *                that deal, only that account: the price ladder is untouched)
 *   their own    any member write on the deal (Keep, Pass, a stage move, an
 *                email answer) makes the Keep theirs: saved_by goes back to
 *                null, and the decision records what they did
 *   not theirs   until then, things that learn from or reward a member's
 *                Keeps skip it (siSavedPairs)
 *
 * Every read is tolerant: before the Batch 25 schema is run the column and
 * table are missing, a read answers "no SI saves", and the site behaves as
 * before. Nothing here is a separate query that could fail an existing one.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

export const SI_SAVED_BY = 'stayful_intelligence';

const CHUNK = 150;
/** PostgREST returns at most 1,000 rows a read: every read here is paged. */
const PAGE = 1000;
const chunks = <T,>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

export const siKey = (userId: string, dealId: string) => `${userId}:${dealId}`;

/**
 * The SI saves (Keeps the member hasn't made their own) among these members'
 * reactions, as user:deal keys. Every page is read: a save missed here would
 * count as the member's own Keep.
 */
export async function siSavedPairs(admin: Admin, userIds: readonly string[] | null, dealIds?: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!hasServiceRole()) return out;
  const users = userIds === null ? [null] : chunks([...new Set(userIds)]);
  const deals = dealIds ? chunks([...new Set(dealIds)]) : [null];
  for (const u of users) {
    if (u !== null && u.length === 0) continue;
    for (const d of deals) {
      for (let from = 0; ; from += PAGE) {
        let q = admin.from('deal_reactions').select('user_id, deal_id').not('saved_by', 'is', null);
        if (u) q = q.in('user_id', u);
        if (d) q = q.in('deal_id', d);
        const { data, error } = await q.order('user_id', { ascending: true }).order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
        if (error) return out;
        for (const r of (data ?? []) as { user_id: string; deal_id: string }[]) out.add(siKey(r.user_id, r.deal_id));
        if ((data?.length ?? 0) < PAGE) break;
      }
    }
  }
  return out;
}

/** The deals one member has an SI save on (Keeps they haven't made their own). */
export async function siSavedDealIds(admin: Admin, userId: string): Promise<Set<string>> {
  const pairs = await siSavedPairs(admin, [userId]);
  return new Set([...pairs].map((k) => k.slice(userId.length + 1)));
}

/**
 * The deals that still carry the "Saved for you by Stayful Intelligence"
 * label for this account: saved, not opened, not moved, not "Not for me".
 */
export async function labelledSaves(userId: string): Promise<Set<string>> {
  if (!hasServiceRole()) return new Set();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('standout_decisions')
    .select('deal_id')
    .eq('user_id', userId)
    .not('saved_at', 'is', null)
    .is('not_for_me_at', null)
    .is('opened_at', null)
    .is('stage_moved_at', null)
    .not('deal_id', 'is', null)
    .limit(500);
  if (error) return new Set();
  const saved = new Set(((data ?? []) as { deal_id: string }[]).map((r) => r.deal_id));
  if (saved.size === 0) return saved;
  // Still the SI's Keep: a member who moved it some other way made it theirs.
  const still = await siSavedDealIds(admin, userId);
  return new Set([...saved].filter((id) => still.has(id)));
}

/** Whether opening this deal is free for this account: saved for it by Stayful Intelligence and not turned down. */
export async function isFreeStandoutOpen(userId: string, dealId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient()
    .from('standout_decisions')
    .select('id')
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .not('saved_at', 'is', null)
    .is('not_for_me_at', null)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** The free-open deals among these, for this account (card prices). */
export async function freeStandoutOpens(userId: string, dealIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!hasServiceRole() || dealIds.length === 0) return out;
  for (const some of chunks([...new Set(dealIds)])) {
    const { data, error } = await createAdminClient().from('standout_decisions').select('deal_id').eq('user_id', userId).in('deal_id', some).not('saved_at', 'is', null).is('not_for_me_at', null);
    if (error) return out;
    for (const r of (data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
  }
  return out;
}

export type MemberAct = 'opened' | 'stage' | 'not_for_me';

const ACT_COLUMN: Record<MemberAct, string> = { opened: 'opened_at', stage: 'stage_moved_at', not_for_me: 'not_for_me_at' };

/**
 * The member did something with a deal: the Keep becomes theirs (saved_by
 * back to null, except on an open, which moves nothing) and an SI save's
 * decision records it once. Best-effort and silent: never fails the action
 * that called it.
 */
export async function noteMemberActed(userId: string, dealId: string, act: MemberAct, at: Date = new Date()): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const admin = createAdminClient();
    const iso = at.toISOString();
    if (act !== 'opened') await admin.from('deal_reactions').update({ saved_by: null }).eq('user_id', userId).eq('deal_id', dealId).not('saved_by', 'is', null);
    await admin.from('standout_decisions').update({ [ACT_COLUMN[act]]: iso, updated_at: iso }).eq('user_id', userId).eq('deal_id', dealId).not('saved_at', 'is', null).is(ACT_COLUMN[act], null);
  } catch (err) {
    console.error('[standout] member act not recorded:', err);
  }
}

/** How long after "Not for me" an undo is still accepted (the page shows it for five seconds). */
export const UNDO_WINDOW_MS = 60_000;

/**
 * Put back a deal the member said "Not for me" to a moment ago: the SI's
 * Keep again and the label back. Only within UNDO_WINDOW_MS, and only while
 * their answer is still that Pass.
 */
export async function undoNotForMe(userId: string, dealId: string, now: Date = new Date()): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const admin = createAdminClient();
  const since = new Date(now.getTime() - UNDO_WINDOW_MS).toISOString();
  const { data: d, error } = await admin.from('standout_decisions').update({ not_for_me_at: null, stage_moved_at: null, updated_at: now.toISOString() }).eq('user_id', userId).eq('deal_id', dealId).gte('not_for_me_at', since).is('opened_at', null).select('id');
  if (error || (d ?? []).length !== 1) return false;
  const { error: rErr } = await admin.from('deal_reactions').update({ reaction: 'keep', reasons: [], saved_by: SI_SAVED_BY, updated_at: now.toISOString() }).eq('user_id', userId).eq('deal_id', dealId).eq('reaction', 'pass');
  if (rErr) console.error('[standout] undo failed:', rErr.message);
  return !rErr;
}
