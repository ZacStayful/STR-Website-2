import 'server-only';

/**
 * Today's 5 for the daily email: the member's stored Today list (Batch 4's
 * todaySelection), drawn in exactly the order /today draws it (displayOrder:
 * the pick first, displacing the lowest untouched card), as cards that are
 * live and visible to the member now (as dealCardsByIds keeps them). The
 * email and the page read the same stored row through the same functions, so
 * they cannot disagree about which deals are today's.
 *
 * Everything is read before a run's send loop, in bulk and with a bounded
 * number of lists being chosen at once, because the picks passes have no
 * time to spare. A member whose list is not ready in time gets their email
 * without teasers rather than a list that might differ from the page.
 */
import type { createAdminClient } from '../supabase/admin';
import { todaySelection, type MemberContext } from '../today/selection';
import { displayOrder, todayKey, TODAY_SIZE } from '../today/day';
import { CARD_COLUMNS, type DealCard } from '../marketplace/grid';
import { projectCardsFor } from '../marketplace/queries';
import { dealVisible, type DealVisibility } from '../marketplace/visibility';
import { payersFor, type Payer } from '../team';
import { seatKey } from '../profiles/rules';
import { dealTypeOf, type DealType } from '../profile/deal-types';

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;

export interface TodayPlan {
  stored: string[];
  advice: string | null;
  nearMiss: boolean;
  /** Stored deals the member has kept or passed already: displayOrder never drops those. */
  answered: Set<string>;
  /** Live cards for the stored deals, by id (visibility is applied per member at draw time). */
  cards: Map<string, DealCard>;
}

/** payersFor, a chunk at a time: one `.in()` over every member would outgrow the request at scale. */
export async function payersForAll(userIds: readonly string[]): Promise<Map<string, Payer>> {
  const out = new Map<string, Payer>();
  for (let i = 0; i < userIds.length; i += ID_CHUNK) for (const [k, v] of await payersFor(userIds.slice(i, i + ID_CHUNK))) out.set(k, v);
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The key a plan is kept under: the member, or the member's profile (seatKey in src/lib/profiles/rules.ts). */
export function planKey(m: Pick<MemberContext, 'userId' | 'profileId'>): string {
  return seatKey(m.userId, m.profileId ?? null);
}

/**
 * Each member's Today list, keyed by planKey (one per saved profile). With
 * `create`, a list not chosen yet is chosen and stored now (exactly what the
 * member's first visit would do); without it (dry runs), only a stored list
 * is read and nothing is written. One member's profiles are chosen one after
 * another, in the order given (active first), so each leaves out what the
 * one before it took: no deal twice across a member's profiles in a day.
 */
export async function todayPlans(admin: Admin, members: readonly MemberContext[], now: Date, opts: { create: boolean; concurrency?: number }): Promise<Map<string, TodayPlan | null>> {
  const out = new Map<string, TodayPlan | null>();
  if (members.length === 0) return out;
  const lists = new Map<string, { stored: string[]; advice: string | null; nearMiss: boolean } | null>();
  if (opts.create) {
    const byUser = new Map<string, MemberContext[]>();
    for (const m of members) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
    await mapLimit([...byUser.values()], opts.concurrency ?? 6, async (seats) => {
      for (const m of seats) {
        const chosen = await todaySelection(m, now).catch((err) => {
          console.error('[notify] today selection failed:', (err as Error)?.message ?? err);
          return null;
        });
        lists.set(planKey(m), chosen ? { stored: chosen.dealIds, advice: chosen.advice, nearMiss: chosen.nearMiss } : null);
      }
    });
  } else {
    const day = todayKey(now);
    const parse = (r: { deal_ids: unknown; near_miss: unknown; advice: unknown }) => ({ stored: Array.isArray(r.deal_ids) ? r.deal_ids.filter((x): x is string => typeof x === 'string') : [], advice: typeof r.advice === 'string' && r.advice.trim() ? r.advice : null, nearMiss: r.near_miss === true });
    const legacy = members.filter((m) => !m.profileId).map((m) => m.userId);
    for (let i = 0; i < legacy.length; i += ID_CHUNK) {
      const { data, error } = await admin.from('today_selections').select('user_id, deal_ids, near_miss, advice').eq('day', day).in('user_id', legacy.slice(i, i + ID_CHUNK));
      if (error) console.warn('[notify] today read failed:', error.message);
      for (const r of (data ?? []) as { user_id: string; deal_ids: unknown; near_miss: unknown; advice: unknown }[]) lists.set(r.user_id, parse(r));
    }
    const seats = members.filter((m) => m.profileId);
    for (let i = 0; i < seats.length; i += ID_CHUNK) {
      const { data, error } = await admin.from('profile_today_lists').select('user_id, profile_id, deal_ids, near_miss, advice').eq('day', day).in('profile_id', seats.slice(i, i + ID_CHUNK).map((m) => m.profileId!));
      if (error) console.warn('[notify] profile today read failed:', error.message);
      for (const r of (data ?? []) as { user_id: string; profile_id: string; deal_ids: unknown; near_miss: unknown; advice: unknown }[]) lists.set(planKey({ userId: r.user_id, profileId: r.profile_id }), parse(r));
    }
  }

  // Answers and cards for every stored deal, once for the whole run.
  const allIds = [...new Set([...lists.values()].flatMap((l) => l?.stored ?? []))];
  const cards = new Map<string, DealCard>();
  for (let i = 0; i < allIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('marketplace_deals').select(`${CARD_COLUMNS}, photo`).in('id', allIds.slice(i, i + ID_CHUNK)).eq('status', 'live');
    if (error) console.warn('[notify] today cards read failed:', error.message);
    for (const { photo, ...card } of (data ?? []) as unknown as (DealCard & { photo: string | null })[]) cards.set(card.id, { ...card, has_photo: Boolean(photo) });
  }
  // Batch 17: a Project teaser shows its own numbers and label.
  const projects = await projectCardsFor([...cards.values()].filter((c) => c.kind === 'sale').map((c) => c.id));
  for (const [id, project] of projects) {
    const card = cards.get(id);
    if (card) cards.set(id, { ...card, project });
  }
  const answered = new Map<string, Set<string>>();
  const withLists = [...new Set(members.filter((m) => (lists.get(planKey(m))?.stored.length ?? 0) > 0).map((m) => m.userId))];
  for (let i = 0; i < withLists.length; i += ID_CHUNK) {
    for (let j = 0; j < allIds.length; j += ID_CHUNK) {
      const { data, error } = await admin.from('deal_reactions').select('user_id, deal_id').in('user_id', withLists.slice(i, i + ID_CHUNK)).in('deal_id', allIds.slice(j, j + ID_CHUNK));
      if (error) console.warn('[notify] today answers read failed:', error.message);
      for (const r of (data ?? []) as { user_id: string; deal_id: string }[]) answered.set(r.user_id, new Set([...(answered.get(r.user_id) ?? []), r.deal_id]));
    }
  }
  for (const m of members) {
    const l = lists.get(planKey(m));
    if (!l) {
      out.set(planKey(m), null);
      continue;
    }
    const mine = new Map<string, DealCard>();
    for (const id of l.stored) {
      const c = cards.get(id);
      if (c) mine.set(id, c);
    }
    out.set(planKey(m), { ...l, answered: answered.get(m.userId) ?? new Set(), cards: mine });
  }
  return out;
}

/**
 * The teasers, in /today's order with the pick left out: the stored list
 * through displayOrder, then only deals still live and visible to this
 * member now — dealCardsByIds' rule, applied to the prefetched cards.
 * Batch 17: with the pick's deal type, the pick makes room from the type the
 * day holds most of, as /today does, so the email keeps the same mix.
 */
export function teasersFrom(plan: TodayPlan, pickDealId: string | null, visibility: DealVisibility, pickType: DealType | null = null): DealCard[] {
  const typeOf = (id: string): DealType | null => {
    if (id === pickDealId) return pickType;
    const card = plan.cards.get(id);
    return card ? dealTypeOf(card) : null;
  };
  const order = displayOrder(plan.stored, pickDealId, plan.answered, TODAY_SIZE, pickDealId ? typeOf : undefined).filter((id) => id !== pickDealId);
  return order.map((id) => plan.cards.get(id)).filter((c): c is DealCard => c !== undefined && dealVisible(c.live_since ?? null, visibility.cutoffIso));
}
