import 'server-only';

/**
 * Keep and Pass: the reads and writes. deal_reactions has RLS on and no
 * member policies, so every caller here has already checked the session and
 * every query is scoped by the member's own id. Nothing here touches credit:
 * reacting to a deal is free, whoever you are.
 *
 * For other batches:
 *   - keptDealIds(userId)       the member's kept list (My deals, watchlist alerts)
 *   - reactionsFor(userId, ids) the state to draw on a page of cards
 *   - dealFeedbackFor(...)      what the daily picks run merges with pick answers
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { dealVisible, type DealVisibility } from './visibility';
import { cleanPassReasons, dealReactionToFeedback, isDealReaction, type DealFeedbackFacts, type DealReaction, type FeedbackEntry } from './reactions';

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const ID_CHUNK = 150;

export type ReactionOutcome = { ok: true; reaction: DealReaction | null } | { ok: false; code: 'missing' | 'gone' | 'failed' };

/**
 * Sets a member's reaction to exactly `target` (null clears it). Idempotent:
 * the row is keyed on (member, deal), so a double tap or a replayed request
 * lands on the same row in the same state.
 *
 * Setting a reaction needs the deal to be live and visible to this member —
 * an account inside the early-access window cannot keep or pass a deal it
 * cannot see, even by posting its id. Clearing is always allowed, so a kept
 * deal that has since gone can still be taken off the list.
 */
export async function setDealReaction(userId: string, dealId: string, target: DealReaction | null, visibility: DealVisibility): Promise<ReactionOutcome> {
  if (!hasServiceRole()) return { ok: false, code: 'failed' };
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  if (target === null) {
    const { error } = await admin.from('deal_reactions').delete().eq('user_id', userId).eq('deal_id', dealId);
    if (error) {
      console.error('[deal-reactions] clear failed:', error.message);
      return { ok: false, code: 'failed' };
    }
    return { ok: true, reaction: null };
  }
  if (!isDealReaction(target)) return { ok: false, code: 'failed' };
  const { data: deal, error: dealErr } = await admin.from('marketplace_deals').select('id, status, live_since').eq('id', dealId).maybeSingle();
  if (dealErr) {
    console.error('[deal-reactions] deal read failed:', dealErr.message);
    return { ok: false, code: 'failed' };
  }
  if (!deal || !dealVisible(deal.live_since as string | null, visibility.cutoffIso)) return { ok: false, code: 'missing' };
  if (deal.status !== 'live') return { ok: false, code: 'gone' };
  // A keep never carries pass reasons (they would go on training the picks).
  // A pass leaves reasons alone, so a repeated pass cannot wipe the answer
  // the member gave a moment ago; a keep → pass switch starts from the keep's
  // empty list either way.
  const row: Record<string, unknown> = { user_id: userId, deal_id: dealId, reaction: target, updated_at: nowIso };
  if (target === 'keep') row.reasons = [];
  const { error } = await admin.from('deal_reactions').upsert(row, { onConflict: 'user_id,deal_id' });
  if (error) {
    console.error('[deal-reactions] set failed:', error.message);
    return { ok: false, code: 'failed' };
  }
  return { ok: true, reaction: target };
}

/** Why a member passed. Only ever written to a row that is still a pass; unknown reasons are dropped. */
export async function setPassReasons(userId: string, dealId: string, reasons: unknown): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data, error } = await createAdminClient()
    .from('deal_reactions')
    .update({ reasons: cleanPassReasons(reasons), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .eq('reaction', 'pass')
    .select('deal_id');
  if (error) {
    console.error('[deal-reactions] reasons failed:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** The member's reaction to each of these deals, for drawing a page of cards. Empty on any failure. */
export async function reactionsFor(userId: string, dealIds: string[]): Promise<Map<string, DealReaction>> {
  const out = new Map<string, DealReaction>();
  if (!hasServiceRole() || dealIds.length === 0) return out;
  const { data, error } = await createAdminClient().from('deal_reactions').select('deal_id, reaction').eq('user_id', userId).in('deal_id', dealIds);
  if (error) {
    // Schema behind: the cards draw with no state rather than the page failing.
    console.warn('[deal-reactions] read failed:', error.message);
    return out;
  }
  for (const r of (data ?? []) as { deal_id: string; reaction: unknown }[]) if (isDealReaction(r.reaction)) out.set(r.deal_id, r.reaction);
  return out;
}

/**
 * Every deal the member has kept, newest first: the kept list other batches
 * build on. Ids only, whatever each deal's state now: a kept deal may since
 * have gone, and the caller must still apply the member's visibility
 * (dealVisible) before showing one.
 */
export async function keptDealIds(userId: string): Promise<string[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('deal_reactions').select('deal_id').eq('user_id', userId).eq('reaction', 'keep').order('updated_at', { ascending: false }).order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.warn('[deal-reactions] kept read failed:', error.message);
      break;
    }
    ids.push(...((data ?? []) as { deal_id: string }[]).map((r) => r.deal_id));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return ids;
}

type ReactionRow = { user_id: string; deal_id: string; reaction: unknown; reasons: unknown; updated_at: string };
type FactsRow = DealFeedbackFacts & { id: string; canonical_url: string };

/**
 * What the daily picks run needs from the grid, for a set of members:
 *   entries    — each reaction since `sinceIso` as pick feedback, keyed by the
 *                listing's canonical_url so it can be merged with pick answers
 *   passedUrls — EVERY deal the member has passed, however long ago, so a
 *                passed deal is never picked (a pool pick is an auto-open
 *                and is charged)
 * Paged throughout: grid reactions far outnumber pick answers and an
 * unpaged read would stop silently at the API's row cap.
 */
export async function dealFeedbackFor(admin: Admin, userIds: string[], sinceIso: string): Promise<{ entries: Map<string, FeedbackEntry[]>; passedUrls: Map<string, Set<string>> }> {
  const entries = new Map<string, FeedbackEntry[]>();
  const passedUrls = new Map<string, Set<string>>();
  const rows: ReactionRow[] = [];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const some = userIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from('deal_reactions').select('user_id, deal_id, reaction, reasons, updated_at').in('user_id', some).order('user_id', { ascending: true }).order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) {
        // Schema behind: picks run exactly as they did before this table existed.
        console.warn('[sourcing] deal_reactions select failed (schema behind?):', error.message);
        return { entries, passedUrls };
      }
      rows.push(...((data ?? []) as ReactionRow[]));
      if ((data?.length ?? 0) < PAGE) break;
    }
  }
  if (rows.length === 0) return { entries, passedUrls };

  const facts = new Map<string, FactsRow>();
  const dealIds = [...new Set(rows.map((r) => r.deal_id))];
  for (let i = 0; i < dealIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select('id, canonical_url, kind, postcode_area, outcode, bedrooms, price_amount, price_period, raw_type, screening').in('id', dealIds.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[sourcing] deal facts select failed:', error.message);
      continue;
    }
    for (const d of (data ?? []) as FactsRow[]) facts.set(d.id, d);
  }

  const since = Date.parse(sinceIso);
  for (const r of rows) {
    const d = facts.get(r.deal_id);
    if (!d || !isDealReaction(r.reaction)) continue;
    if (r.reaction === 'pass') {
      const set = passedUrls.get(r.user_id) ?? new Set<string>();
      set.add(d.canonical_url);
      passedUrls.set(r.user_id, set);
    }
    if (!(Date.parse(r.updated_at) >= since)) continue;
    const list = entries.get(r.user_id) ?? [];
    list.push({ url: d.canonical_url, at: r.updated_at, feedback: dealReactionToFeedback({ reaction: r.reaction, reasons: r.reasons }, d) });
    entries.set(r.user_id, list);
  }
  return { entries, passedUrls };
}
