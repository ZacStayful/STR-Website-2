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
import { dealVisible, type DealVisibility } from '../marketplace/visibility';
import { payersFor, type Payer } from '../team';

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

/**
 * Each member's Today list. With `create`, a member with no list yet gets one
 * chosen and stored now (exactly what their first visit would do); without
 * it (dry runs), only a stored list is read and nothing is written.
 */
export async function todayPlans(admin: Admin, members: readonly MemberContext[], now: Date, opts: { create: boolean; concurrency?: number }): Promise<Map<string, TodayPlan | null>> {
  const out = new Map<string, TodayPlan | null>();
  if (members.length === 0) return out;
  const lists = new Map<string, { stored: string[]; advice: string | null; nearMiss: boolean } | null>();
  if (opts.create) {
    const chosen = await mapLimit(members, opts.concurrency ?? 6, (m) => todaySelection(m, now).catch((err) => {
      console.error('[notify] today selection failed:', (err as Error)?.message ?? err);
      return null;
    }));
    members.forEach((m, i) => lists.set(m.userId, chosen[i] ? { stored: chosen[i]!.dealIds, advice: chosen[i]!.advice, nearMiss: chosen[i]!.nearMiss } : null));
  } else {
    const day = todayKey(now);
    for (let i = 0; i < members.length; i += ID_CHUNK) {
      const some = members.slice(i, i + ID_CHUNK).map((m) => m.userId);
      const { data, error } = await admin.from('today_selections').select('user_id, deal_ids, near_miss, advice').eq('day', day).in('user_id', some);
      if (error) console.warn('[notify] today read failed:', error.message);
      for (const r of (data ?? []) as { user_id: string; deal_ids: unknown; near_miss: unknown; advice: unknown }[]) {
        lists.set(r.user_id, { stored: Array.isArray(r.deal_ids) ? r.deal_ids.filter((x): x is string => typeof x === 'string') : [], advice: typeof r.advice === 'string' && r.advice.trim() ? r.advice : null, nearMiss: r.near_miss === true });
      }
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
  const answered = new Map<string, Set<string>>();
  const withLists = [...lists.entries()].filter(([, l]) => l && l.stored.length > 0).map(([id]) => id);
  for (let i = 0; i < withLists.length; i += ID_CHUNK) {
    for (let j = 0; j < allIds.length; j += ID_CHUNK) {
      const { data, error } = await admin.from('deal_reactions').select('user_id, deal_id').in('user_id', withLists.slice(i, i + ID_CHUNK)).in('deal_id', allIds.slice(j, j + ID_CHUNK));
      if (error) console.warn('[notify] today answers read failed:', error.message);
      for (const r of (data ?? []) as { user_id: string; deal_id: string }[]) answered.set(r.user_id, new Set([...(answered.get(r.user_id) ?? []), r.deal_id]));
    }
  }
  for (const m of members) {
    const l = lists.get(m.userId);
    if (!l) {
      out.set(m.userId, null);
      continue;
    }
    const mine = new Map<string, DealCard>();
    for (const id of l.stored) {
      const c = cards.get(id);
      if (c) mine.set(id, c);
    }
    out.set(m.userId, { ...l, answered: answered.get(m.userId) ?? new Set(), cards: mine });
  }
  return out;
}

/**
 * The teasers, in /today's order with the pick left out: the stored list
 * through displayOrder, then only deals still live and visible to this
 * member now — dealCardsByIds' rule, applied to the prefetched cards.
 */
export function teasersFrom(plan: TodayPlan, pickDealId: string | null, visibility: DealVisibility): DealCard[] {
  const order = displayOrder(plan.stored, pickDealId, plan.answered, TODAY_SIZE).filter((id) => id !== pickDealId);
  return order.map((id) => plan.cards.get(id)).filter((c): c is DealCard => c !== undefined && dealVisible(c.live_since ?? null, visibility.cutoffIso));
}
