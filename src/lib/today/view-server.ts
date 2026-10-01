import 'server-only';

/**
 * Today's list as the page shows it (Batch 22: one loader for /today and the
 * signup reveal, so the reveal is Today's own first cards by construction):
 * the stored day list, this morning's pick put first (making room from the
 * most shown type), and only cards still live and visible to the member.
 *
 * Moved here from src/app/today/page.tsx unchanged.
 */
import { dealCardsByIds, dealTypesByIds } from '../marketplace/queries';
import { reactionsFor } from '../marketplace/reactions-server';
import type { DealReaction } from '../marketplace/reaction-state';
import { usesTailoring } from '../tailoring/profile';
import type { WidenOption } from '../tailoring/widen';
import { displayOrder, TODAY_SIZE } from './day';
import { todaySelection, todaysPick, widenOptionsFor, type MemberContext, type TodaySelection, type TodaysPick } from './selection';

export interface TodayView {
  selection: TodaySelection | null;
  pick: TodaysPick | null;
  pickDealId: string | null;
  /** The stored list with the pick: what "answered" and widen are read against. */
  onDay: string[];
  answered: Map<string, DealReaction>;
  /** The tailored day is short of TODAY_SIZE. */
  short: boolean;
  widen: WidenOption[];
  /** The order shown, before dropping cards no longer live or visible. */
  order: string[];
  cards: Awaited<ReturnType<typeof dealCardsByIds>>;
}

/**
 * `paused`: a paused profile has no daily deals (no list, no pick).
 * `widen`: work out widen-and-see for a short tailored day (Today only).
 */
export async function loadTodayView(member: MemberContext, now: Date, opts: { paused?: boolean; widen?: boolean } = {}): Promise<TodayView> {
  const [selection, pick] = await Promise.all([
    opts.paused ? Promise.resolve(null) : todaySelection(member, now),
    opts.paused ? Promise.resolve(null) : todaysPick(member.userId, now, member.profileId ?? null),
  ]);
  const stored = selection?.dealIds ?? [];
  const pickDealId = pick?.dealId ?? null;
  const onDay = [...new Set(pickDealId ? [pickDealId, ...stored] : stored)];
  const short = selection !== null && usesTailoring(member.tailoring) && onDay.length < TODAY_SIZE;
  const [answered, widen, typeOf] = await Promise.all([
    reactionsFor(member.userId, onDay),
    short && opts.widen ? widenOptionsFor(member, onDay, now) : Promise.resolve([] as WidenOption[]),
    // Batch 17: the pick makes room from the most shown type, so the day's mix holds.
    pickDealId && stored.length >= TODAY_SIZE ? dealTypesByIds(onDay) : Promise.resolve(null),
  ]);
  const order = displayOrder(stored, pickDealId, new Set(answered.keys()), TODAY_SIZE, typeOf ? (id) => typeOf.get(id) ?? null : undefined);
  const cards = await dealCardsByIds(order, member.visibility);
  return { selection, pick, pickDealId, onDay, answered, short, widen, order, cards };
}
