/**
 * How a buy-to-let deal shows on a card (Batch 28, Part F), for the one card
 * component (deals/_components/DealCard.tsx through card-view.ts): the
 * "Buy to let" badge, exactly three numbers following what the member is
 * after, and the flags that apply ("Service charge not confirmed", "EPC
 * below C", "24 miles from Leeds"). Only the stored card's figures, every
 * one a range: never a short-let figure, an address or a link.
 *
 * A deal is shown as Buy to let when that is the first of its types the
 * member chose (dealTypeFor), so a deal that is only a buy-to-let deal
 * always is, whoever looks.
 *
 * Pure: no network, no database, no server-only.
 */
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { dealTypeFor, type DealType, type TypedDeal } from '../profile/deal-types.ts';
import { btlFlags, btlNumbers, RENT_CONFIDENCE_WORDS, type BtlCard, type BtlCardNumber } from './card.ts';
import type { BtlPriority } from './rules.ts';
import type { CashBand } from './deal.ts';
import { centreAreaOf, DEFAULT_BTL_PRIORITY } from './today.ts';
import { areaMetaForCode } from '../market/areas.ts';
import type { MarketGoals } from '../market/goals.ts';
import type { AboutYou } from '../profile/about.ts';
import { typesShown } from '../profile/deal-types.ts';
import { filtersForType } from '../today/type-filters.ts';

export const BTL_BADGE = 'Buy to let';

/** Who is looking: their types, what they are after, and where they search from (for "24 miles from Leeds"). */
export interface BtlLooker {
  types?: readonly DealType[];
  priority?: BtlPriority | null;
  /** Where they search: its centre and name. Null: no distance shown. */
  from?: { lat: number; lng: number; name: string } | null;
  /** Their own areas: a deal inside them shows no distance. */
  ownAreas?: readonly string[];
  /** The postcode area their benchmark is read for (centreAreaOf). */
  centre?: string | null;
  /** Their cash band, when they have said. */
  cashBand?: CashBand | null;
}

export interface BtlView {
  numbers: BtlCardNumber[];
  flags: string[];
  /** "Good rent evidence · 14 rentals nearby": what the rent rests on. */
  caption: string;
  /** "£51,200–£56,200 cash in". */
  cash: string | null;
  /** The figures are being redone (the price changed since the last screen): nothing to show yet. */
  pending: boolean;
}

/** The member looking at cards: their types, what they are after, and where they search from. */
export function btlLookerFor(goals: MarketGoals | null, savedAreas: readonly string[], about: AboutYou | null = null): BtlLooker {
  const types = typesShown({ goals, about });
  if (!types.includes('btl')) return { types };
  const own = filtersForType(goals, savedAreas, 'btl').areas;
  const centre = centreAreaOf(goals, own);
  const at = centre ? areaCentroid(centre) : null;
  const name = own.length === 1 ? areaMetaForCode(own[0]).name : centre ? areaMetaForCode(centre).name : null;
  return { types, priority: goals?.btl?.priority ?? null, from: at && name ? { ...at, name } : null, ownAreas: own, centre, cashBand: goals?.btl?.cashBand ?? null };
}

/** Whether this card is shown as a buy-to-let deal to this member. */
export function showsAsBtl(card: TypedDeal, looker: BtlLooker | null | undefined): boolean {
  return dealTypeFor(card, looker?.types ?? []) === 'btl';
}

/** "24 miles from Leeds" for a deal outside the member's own areas; null inside them or with nothing to measure from. */
export function btlDistance(area: string | null | undefined, looker: BtlLooker | null | undefined): string | null {
  const from = looker?.from ?? null;
  const code = area ? area.toUpperCase() : null;
  if (!from || !code || (looker?.ownAreas ?? []).includes(code)) return null;
  const at = areaCentroid(code);
  if (!at) return null;
  return `${Math.max(1, Math.round(haversineMiles(from, at)))} miles from ${from.name}`;
}

/** The card's buy-to-let view: three numbers, the flags, and what the rent rests on. */
export function btlViewFor(card: { btl?: BtlCard | null; postcode_area?: string | null }, looker: BtlLooker | null | undefined): BtlView {
  const c = card.btl ?? null;
  if (!c) return { numbers: [], flags: [], caption: 'Figures being updated', cash: null, pending: true };
  const priority = looker?.priority ?? DEFAULT_BTL_PRIORITY;
  const comps = c.rent.compCount > 0 ? ` · ${c.rent.compCount} rental${c.rent.compCount === 1 ? '' : 's'} nearby` : '';
  return {
    numbers: btlNumbers(c, priority),
    flags: btlFlags(c, btlDistance(card.postcode_area, looker)),
    caption: `${RENT_CONFIDENCE_WORDS[c.rent.confidence]}${comps}`,
    // The cash in, as the "Cash in" number writes it.
    cash: `${btlNumbers(c, 'income')[0].value} cash in`,
    pending: false,
  };
}

/**
 * The figure the open price ladder reads (Batch 28, Q15): a short-let,
 * Project or rent-to-rent deal's annual profit, as always; a deal in the
 * pool only as a buy-to-let deal, its middle cashflow over a year. One rule
 * for the card, the charge and every price shown, whoever looks.
 */
export function openProfitFor(deal: { kind: string; band?: string | null; project?: unknown; annual_profit: number | string | null; btl?: BtlCard | null }): number | null {
  const btlOnly = deal.kind === 'sale' && deal.band !== undefined && deal.band !== 'qualified' && (deal.project === undefined || deal.project === null);
  if (btlOnly) return deal.btl ? Math.round(deal.btl.cashflowMonthly.mid * 12) : null;
  const n = deal.annual_profit === null ? null : Number(deal.annual_profit);
  return n !== null && Number.isFinite(n) ? n : null;
}

