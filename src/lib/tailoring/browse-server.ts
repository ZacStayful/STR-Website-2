import 'server-only';

/**
 * Browse's "Best for you" pages (Batch 14, Part D): the member's own order
 * (browse.ts) over every deal the grid's filters match, a page at a time.
 *
 * The order is worked out once and kept for a few minutes per member,
 * profile, access and search (TAILORING.browse), so paging never shuffles
 * or repeats a deal. It is keyed on the member's answers too, so a profile
 * edit re-orders at once; what they liked (Keeps) moves the order when it
 * is next worked out, not mid-browse. New or retired deals refresh it with
 * the marketplace's own tag.
 *
 * Every request still takes out the member's passes fresh, and draws its
 * cards through dealCardsByIds, which applies the early-access window again:
 * a kept order can never show a deal early. The rows ranked hold no address
 * and never leave the server: only ids do.
 */
import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { AreaCardData } from '../market/explorer';
import type { MarketGoals } from '../market/goals';
import { DEFAULT_FILTERS, filtersToSearch, PAGE_SIZE, type DealCard, type DealFilters } from '../marketplace/grid';
import { browsePool, dealCardsByIds, type DealPage } from '../marketplace/queries';
import { DEALS_TAG } from '../marketplace/server';
import type { DealVisibility } from '../marketplace/visibility';
import { BROWSE_RANK_COLUMNS, bestForYouOrder, type BrowseRow } from './browse';
import { TAILORING } from './config';
import type { TailoringProfile } from './profile';

export interface BestPage extends DealPage {
  /** The search matched more than the order reads (TAILORING.poolLimit): the page says so. */
  capped: boolean;
}

interface Ranked {
  ids: string[];
  capped: boolean;
}

/** What the order depends on in the member's answers: not what they liked, which may change mid-browse. */
function answersDigest(goals: MarketGoals | null, p: TailoringProfile | null): string {
  const answers = p ? { goals: p.goals, savedAreas: p.savedAreas, about: p.about, answered: p.answered, modes: p.modes, widths: p.widths } : { goals };
  return createHash('sha256').update(JSON.stringify(answers)).digest('hex').slice(0, 24);
}

async function passedIds(userId: string): Promise<Set<string> | null> {
  if (!hasServiceRole()) return null;
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await createAdminClient().from('deal_reactions').select('deal_id').eq('user_id', userId).eq('reaction', 'pass').order('deal_id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.warn('[browse] passes read failed:', error.message);
      return null;
    }
    for (const r of (data ?? []) as { deal_id: string }[]) out.add(r.deal_id);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return out;
}

/**
 * One page of "Best for you". Null when the order cannot be worked out: the
 * page then falls back to the grid's own query, so Browse never goes blank.
 */
export async function bestForYouPage(
  f: DealFilters,
  visibility: DealVisibility,
  member: { userId: string; profileId: string | null; goals: MarketGoals | null; tailoring: TailoringProfile | null },
  cards: readonly AreaCardData[] | null,
): Promise<BestPage | null> {
  const search = filtersToSearch({ ...f, page: 1, sort: 'best', view: 'all' }) || '-';
  const key = ['browse-best-for-you', member.userId, member.profileId ?? '-', visibility.tier, search, answersDigest(member.goals, member.tailoring)];
  const ranked = unstable_cache(
    async (): Promise<Ranked> => {
      const rows = await browsePool(f, visibility, TAILORING.poolLimit, BROWSE_RANK_COLUMNS);
      // Thrown, so a failed read is not kept: the next request tries again.
      if (!rows) throw new Error('the pool could not be read');
      return { ids: bestForYouOrder(rows as BrowseRow[], { goals: member.goals, tailoring: member.tailoring, cards, now: new Date() }), capped: rows.length >= TAILORING.poolLimit };
    },
    key,
    { revalidate: TAILORING.browse.cacheSeconds, tags: [DEALS_TAG] },
  );
  let order: Ranked;
  let passed: Set<string> | null;
  try {
    [order, passed] = await Promise.all([ranked(), passedIds(member.userId)]);
  } catch (err) {
    console.error('[browse] best for you failed:', (err as Error)?.message ?? err);
    return null;
  }
  if (!passed) return null;
  const ids = order.ids.filter((id) => !passed.has(id));
  const total = ids.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  // A page past the end (a stale link, or passes since) serves the last page, as the grid does.
  const page = Math.min(Math.max(1, f.page), Math.max(1, pages));
  const slice = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const got: DealCard[] = await dealCardsByIds(slice, visibility);
  return { cards: got, total, page, pages, capped: order.capped };
}

/**
 * The Market Explorer's "deals on the market here" (Batch 14): the area's
 * top deals in the member's own order, at their own visibility and without
 * the ones they passed. A small read, not kept: the block is one area.
 * Null on any failure: the shared block (best by profit) stands.
 */
export async function bestForYouInArea(
  code: string,
  visibility: DealVisibility,
  member: { userId: string; goals: MarketGoals | null; tailoring: TailoringProfile | null },
  cards: readonly AreaCardData[] | null,
  n = 3,
): Promise<DealCard[] | null> {
  try {
    const [rows, passed] = await Promise.all([browsePool({ ...DEFAULT_FILTERS, areas: [code] }, visibility, TAILORING.poolLimit, BROWSE_RANK_COLUMNS), passedIds(member.userId)]);
    if (!rows || !passed) return null;
    const open = (rows as BrowseRow[]).filter((r) => !passed.has(r.id));
    const byId = new Map(open.map((r) => [r.id, r]));
    return bestForYouOrder(open, { goals: member.goals, tailoring: member.tailoring, cards, now: new Date() })
      .slice(0, n)
      .map((id) => byId.get(id)!)
      .filter(Boolean);
  } catch (err) {
    console.error('[browse] area block failed:', (err as Error)?.message ?? err);
    return null;
  }
}
