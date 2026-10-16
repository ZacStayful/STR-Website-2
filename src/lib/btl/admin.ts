/**
 * /admin/deals/btl's figures as rules (Batch 28, Part J): which deal type a
 * member was shown a deal as, the shown / opened / kept funnel per type, the
 * keep rate, and the widened-search rate. ./admin-server.ts reads the rows.
 *
 * A deal that is two types (a short-let deal that is also a buy-to-let deal)
 * counts once, as the type the member's profile shows it as (dealTypeFor),
 * exactly as Today and the card show it.
 *
 * Pure: no network, no database, no server-only.
 */
import { GOAL_OPTIONS, type DealType, type MarketGoals } from '../market/goals.ts';
import { dealTypeFor, typesShown, type TypedDeal } from '../profile/deal-types.ts';
import { parseBtlWiden } from './today.ts';

export const FUNNEL_TYPES: readonly DealType[] = GOAL_OPTIONS.dealTypes;

export interface Funnel {
  shown: number;
  opened: number;
  keeps: number;
  passes: number;
}

export type FunnelByType = Record<DealType, Funnel>;

export const emptyFunnel = (): FunnelByType => Object.fromEntries(FUNNEL_TYPES.map((t) => [t, { shown: 0, opened: 0, keeps: 0, passes: 0 }])) as FunnelByType;

/** Keeps ÷ (keeps + passes), a percentage to one place; null with nothing to go on. */
export function keepRate(f: Pick<Funnel, 'keeps' | 'passes'>): number | null {
  const n = f.keeps + f.passes;
  return n > 0 ? Math.round((f.keeps / n) * 1000) / 10 : null;
}

/** Every type but this one, added up: "against the other types". */
export function othersThan(by: FunnelByType, type: DealType): Funnel {
  const out: Funnel = { shown: 0, opened: 0, keeps: 0, passes: 0 };
  for (const t of FUNNEL_TYPES) {
    if (t === type) continue;
    out.shown += by[t].shown;
    out.opened += by[t].opened;
    out.keeps += by[t].keeps;
    out.passes += by[t].passes;
  }
  return out;
}

/** The types a profile is shown, from its stored criteria. */
export function profileTypes(goals: MarketGoals | null): DealType[] {
  return typesShown({ goals, about: null });
}

/** The type a deal counts as for these types; null for a deal we cannot type (gone from the pool). */
export function shownAs(deal: TypedDeal | undefined, types: readonly DealType[]): DealType | null {
  return deal ? dealTypeFor(deal, types) : null;
}

export interface ListRow {
  profileId: string;
  dealIds: readonly string[];
  /** Shown earlier in the day and replaced since (profile_today_lists.shown_ids). */
  shownIds?: readonly string[] | null;
  choice?: unknown;
}

export interface WidenTally {
  /** Lists with at least one deal shown as Buy to let. */
  lists: number;
  /** Of those, the ones that had to look beyond the member's own areas. */
  widened: number;
  byScope: Record<'miles' | 'region' | 'national', number>;
}

/**
 * Today's lists, tallied: each list's deals (and those it showed earlier the
 * same day) by the type its profile was shown them as, and how often a list
 * with buy-to-let deals had to look further (choice.btlWiden).
 */
export function tallyLists(lists: readonly ListRow[], deals: ReadonlyMap<string, TypedDeal>, typesOf: (profileId: string) => readonly DealType[], into: FunnelByType = emptyFunnel()): { funnel: FunnelByType; widen: WidenTally } {
  const widen: WidenTally = { lists: 0, widened: 0, byScope: { miles: 0, region: 0, national: 0 } };
  for (const l of lists) {
    const types = typesOf(l.profileId);
    let anyBtl = false;
    for (const id of new Set([...l.dealIds, ...(l.shownIds ?? [])])) {
      const t = shownAs(deals.get(id), types);
      if (!t) continue;
      into[t].shown += 1;
      if (t === 'btl') anyBtl = true;
    }
    if (!anyBtl) continue;
    widen.lists += 1;
    const choice = l.choice && typeof l.choice === 'object' ? (l.choice as { btlWiden?: unknown }) : null;
    const w = parseBtlWiden(choice?.btlWiden);
    if (w) {
      widen.widened += 1;
      widen.byScope[w.found.scope] += 1;
    }
  }
  return { funnel: into, widen };
}

/** A share as a whole percentage; null with nothing to go on. */
export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
