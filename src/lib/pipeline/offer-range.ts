/**
 * The suggested offer at the Offer stage, from real figures only.
 *
 *   T  the target ceiling: the highest price that still hits the member's
 *      target gross yield (purchase), or the highest rent that still leaves
 *      their target monthly margin (rent-to-rent). The same deal maths as the
 *      deal page's "If you bought it" panel (lib/listing/deal.ts), so the two
 *      never disagree.
 *   M  the asking figure less a discount for how long the listing has been
 *      on the market (and, for a purchase, how often it has been cut), from
 *      the admin-set bands (offer-rules.ts).
 *
 *   range = the lower of T and M, up to the higher, never above asking.
 *
 * Whatever is missing is left out and named, never guessed. When T is more
 * than a quarter below asking (or no rent reaches the margin at all) there
 * is no realistic offer to suggest, so nothing is shown but the reason.
 *
 * Returns numbers and reason codes only: the wording is in next-steps.ts.
 * Pure: no network, no database, no `server-only`.
 */
import { purchaseDeal, rentToRentDeal, type FinanceDefaults } from '../listing/deal.ts';
import { purchaseDiscount, rentDiscount, type OfferRules } from './offer-rules.ts';
import type { StepKind } from './types.ts';

/** T below this share of asking hides the range: the gap is too big for an offer to bridge. */
export const TOO_FAR_BELOW_RATIO = 0.75;

/** Figures round down to these, so a rounded target ceiling still hits the target. */
export const ROUND_TO: Record<StepKind, number> = { purchase: 1000, 'rent-to-rent': 10 };

export type OfferMissing = 'notMarketplace' | 'noAsking' | 'noRevenue' | 'studio' | 'noMargin' | 'tooFarBelow' | 'bandsNotSet' | 'noHistory';

export interface OfferInput {
  kind: StepKind;
  /** A marketplace deal. A listing the member added has no history or area model to go on. */
  marketplace: boolean;
  /** Asking price, or asking rent a month. */
  asking: number | null;
  /** The raw target ceiling from targetCeiling(); null when it could not be worked out. */
  target: number | null;
  /** Why there is no target ceiling, when there is none. */
  targetMissing?: 'noRevenue' | 'studio' | null;
  /** Days on the market (portal date, else our first sighting). */
  ageDays: number | null;
  reductions: number;
  rules: OfferRules;
}

/** How the figure reads: "£171,000 to £182,000", "£171,000", "Up to £182,000" or "Around £171,000". */
export type OfferShape = 'range' | 'exact' | 'upTo' | 'around';

export interface OfferRange {
  kind: StepKind;
  show: boolean;
  shape: OfferShape | null;
  low: number | null;
  high: number | null;
  /** The figure to open at: the bottom of the range. */
  opening: number | null;
  /** T, rounded; kept even when the range is hidden as too far below, for the reason's wording. */
  target: { ceiling: number; atOrAboveAsking: boolean } | null;
  history: { discountPct: number; motivated: number; ageDays: number; reductions: number } | null;
  /** M is above T, so it is the top of the range rather than the opening. */
  historyIsTop: boolean;
  missing: OfferMissing[];
}

const floorTo = (n: number, step: number) => Math.floor(n / step) * step;

function hidden(kind: StepKind, missing: OfferMissing[], target: OfferRange['target'] = null): OfferRange {
  return { kind, show: false, shape: null, low: null, high: null, opening: null, target, history: null, historyIsTop: false, missing };
}

/**
 * T from the same inputs the deal page uses: area revenue for the size, the
 * member's finance goals, and the asking figure. Null when there is no
 * revenue to go on.
 */
export function targetCeiling(kind: StepKind, asking: number, revenue: { grossRevenue: number; adr: number } | null, bedrooms: number | null, finance: FinanceDefaults): number | null {
  if (!revenue || !Number.isFinite(revenue.grossRevenue) || revenue.grossRevenue <= 0) return null;
  if (!Number.isFinite(asking) || asking <= 0) return null;
  const base = { grossRevenue: revenue.grossRevenue, adr: revenue.adr, bedrooms: bedrooms ?? 2, finance };
  return kind === 'purchase' ? purchaseDeal(asking, base).maxPriceForTargetYield : rentToRentDeal(asking, base).maxRentForTargetMargin;
}

export function computeOfferRange(input: OfferInput): OfferRange {
  const { kind } = input;
  if (!input.marketplace) return hidden(kind, ['notMarketplace']);
  const asking = input.asking;
  if (asking === null || !Number.isFinite(asking) || asking <= 0) return hidden(kind, ['noAsking']);
  const step = ROUND_TO[kind];
  const missing: OfferMissing[] = [];

  // ── T: the target ceiling ──
  let target: OfferRange['target'] = null;
  const t = input.target;
  if (t === null || !Number.isFinite(t)) {
    missing.push(input.targetMissing ?? 'noRevenue');
  } else if (t <= 0) {
    // maxRentForMargin floors at 0: no rent at all leaves the margin.
    if (kind === 'rent-to-rent') return hidden(kind, ['noMargin']);
    missing.push('noRevenue');
  } else if (t < asking * TOO_FAR_BELOW_RATIO) {
    return hidden(kind, ['tooFarBelow'], { ceiling: floorTo(t, step), atOrAboveAsking: false });
  } else {
    target = t >= asking ? { ceiling: asking, atOrAboveAsking: true } : { ceiling: floorTo(t, step), atOrAboveAsking: false };
  }

  // ── M: asking less the listing-history discount ──
  let history: OfferRange['history'] = null;
  const rulesSet = kind === 'purchase' ? input.rules.purchase !== null : input.rules.rentToRent !== null;
  const ageDays = input.ageDays !== null && Number.isFinite(input.ageDays) && input.ageDays >= 0 ? input.ageDays : null;
  const reductions = Number.isInteger(input.reductions) && input.reductions > 0 ? input.reductions : 0;
  if (!rulesSet) {
    missing.push('bandsNotSet');
  } else if (ageDays === null) {
    missing.push('noHistory');
  } else {
    // No matching row means no discount: the asking figure itself.
    const pct = (kind === 'purchase' ? purchaseDiscount(input.rules.purchase, ageDays, reductions) : rentDiscount(input.rules.rentToRent, ageDays)) ?? 0;
    const motivated = pct > 0 ? floorTo(asking * (1 - pct / 100), step) : asking;
    history = { discountPct: pct, motivated: Math.min(motivated, asking), ageDays, reductions };
  }

  // ── The range ──
  const figures = [target?.ceiling, history?.motivated].filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  if (figures.length === 0) return { ...hidden(kind, missing), target };
  const low = Math.min(...figures);
  const high = Math.min(Math.max(...figures), asking);
  if (low <= 0 || low > high) return hidden(kind, [...missing, 'noAsking']);
  const historyIsTop = target !== null && history !== null && history.motivated > target.ceiling;
  let shape: OfferShape;
  if (target && history) shape = low === high ? 'exact' : 'range';
  else shape = target ? 'upTo' : 'around';
  return { kind, show: true, shape, low, high, opening: low, target, history, historyIsTop, missing };
}
