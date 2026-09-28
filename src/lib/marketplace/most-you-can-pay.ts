/**
 * "Most you can pay" (Batch 14, Part H): the highest asking price (or rent)
 * at which a deal still leaves the member's own minimum monthly profit, at
 * their own deposit, rate and term. It replaces the old ceiling (the price
 * that hits a 10% gross yield), which could tell a member to pay a price
 * that loses them money every month.
 *
 * Worked on the same income as the card's profit range, and on its LOW end:
 * the figure is the price at which the card's range would START at the
 * member's minimum. So "within what you can pay" and "clears your minimum
 * profit" (the must-have, criteria.ts) can never disagree. On a Full
 * analysis the income is the report's own, and the figure is exact.
 *
 *   purchase      listing/deal.ts maxPriceForProfit, rounded down to £1,000
 *   rent-to-rent  listing/deal.ts maxRentForMargin, rounded down to £10
 *
 * Rounded down with the Offer stage's own steps (ROUND_TO), so a rounded
 * figure still clears the profit. The words are "most you can pay to hit
 * your targets": never "value", "worth" or "valuation".
 *
 * Pure: no network, no database, no `server-only`.
 */
import { DEFAULT_FINANCE, maxPriceForProfit, maxRentForMargin, purchaseDeal, rentToRentDeal, type Deal, type FinanceDefaults } from '../listing/deal.ts';
import type { MarketGoals } from '../market/goals.ts';
import { ROUND_TO } from '../pipeline/offer-range.ts';
import { TAILORING } from '../tailoring/config.ts';

export interface PayInput {
  kind: 'sale' | 'rent';
  /** The short-let income behind it, £ a year: the screening's area estimate, or a Full analysis's own figure. */
  grossRevenue: number | string | null;
  bedrooms: number | null;
  /** The member's finance (their active profile's); the house figures without one (a public page). */
  finance?: Partial<FinanceDefaults> | null;
  /** They buy with cash (the quiz's funding answer): nothing is borrowed. */
  cashBuyer?: boolean;
  /** The card's profit range half-width, %. 0 for an exact income (a Full analysis). */
  widthPct: number;
}

export interface PayCeiling {
  kind: 'sale' | 'rent';
  /** price: `amount` is the most; none: no price (rent) leaves the profit; any: nothing is borrowed, so no price is too high. */
  state: 'price' | 'none' | 'any';
  /** Rounded down; null unless state is 'price'. */
  amount: number | null;
  minProfitPcm: number;
  depositPct: number;
  mortgageRatePct: number;
  termYears: number;
  /** What income it rests on: the area estimate (a card, the sheet), a Full analysis's own (exact), or a listing's own estimate (a shared listing). */
  basis: 'area' | 'exact' | 'listing';
  /** Worked on the house figures, not the member's (a public page, or no answers yet). */
  house: boolean;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The monthly profit the model must show for the card's range to start at
 * the minimum: the range is ±width% of it, and at least £10 either side.
 */
export function profitNeeded(minProfitPcm: number, widthPct: number): number {
  if (widthPct <= 0) return minProfitPcm;
  const p = Math.min(0.99, widthPct / 100);
  return Math.max(minProfitPcm + 10, minProfitPcm / (1 - p));
}

/** Null when there is no income to work from. */
export function mostYouCanPay(input: PayInput): PayCeiling | null {
  const gross = num(input.grossRevenue);
  if (gross === null || gross <= 0) return null;
  const house = !input.finance;
  const fin: FinanceDefaults = { ...DEFAULT_FINANCE, ...(input.finance ?? {}) };
  const minProfit = Number.isFinite(fin.targetMarginPcm) ? fin.targetMarginPcm : TAILORING.fallbackMinProfitPcm;
  const depositPct = input.cashBuyer ? 100 : fin.depositPct;
  const base = { kind: input.kind, minProfitPcm: minProfit, depositPct, mortgageRatePct: fin.mortgageRatePct, termYears: fin.termYears, basis: input.widthPct <= 0 ? ('exact' as const) : ('area' as const), house };
  const need = profitNeeded(minProfit, input.widthPct);
  const model = { grossRevenue: gross, adr: 0, bedrooms: input.bedrooms ?? 2, finance: fin };
  if (input.kind === 'rent') {
    const rent = maxRentForMargin(rentToRentDeal(0, model).monthlyNetBeforeRent, need);
    const step = ROUND_TO['rent-to-rent'];
    const amount = Math.floor(rent / step) * step;
    return amount > 0 ? { ...base, state: 'price', amount } : { ...base, state: 'none', amount: null };
  }
  const r = maxPriceForProfit(purchaseDeal(0, model).netOperating, need, depositPct, fin.mortgageRatePct, fin.termYears);
  if ('none' in r) return { ...base, state: 'none', amount: null };
  if ('any' in r) return { ...base, state: 'any', amount: null };
  const step = ROUND_TO.purchase;
  const amount = Math.floor(r.price / step) * step;
  return amount > 0 ? { ...base, state: 'price', amount } : { ...base, state: 'none', amount: null };
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** "Most you can pay ~£221,000" / "Most rent you can pay ~£980" / "No price reaches your £300/month at these figures". */
export function payLine(c: PayCeiling): string {
  const target = `${gbp(c.minProfitPcm)}/month`;
  const approx = c.basis === 'exact' ? '' : '~';
  if (c.state === 'any') return `Any price clears ${c.house ? '' : 'your '}${target}; check your return on cash instead`;
  if (c.state === 'none') return c.kind === 'rent' ? `No rent leaves ${c.house ? '' : 'your '}${target} at these figures` : `No price reaches ${c.house ? '' : 'your '}${target} at these figures`;
  return c.kind === 'rent' ? `Most rent you can pay ${approx}${gbp(c.amount!)}` : `Most you can pay ${approx}${gbp(c.amount!)}`;
}

/** "For £300/month profit at your 25% deposit, 5.5% over 25 years (area estimate)". */
export function basisLine(c: PayCeiling): string {
  const whose = c.house ? 'a' : 'your';
  const tail = c.basis === 'exact' ? '(exact for this property)' : c.basis === 'listing' ? '(estimate for this listing)' : '(area estimate)';
  if (c.kind === 'rent') return `For ${gbp(c.minProfitPcm)}/month profit after the rent ${tail}`;
  if (c.depositPct >= 100) return `For ${gbp(c.minProfitPcm)}/month profit, buying with cash ${tail}`;
  const rate = `${Number.isInteger(c.mortgageRatePct) ? c.mortgageRatePct : Math.round(c.mortgageRatePct * 100) / 100}%`;
  return `For ${gbp(c.minProfitPcm)}/month profit at ${whose} ${c.depositPct}% deposit, ${rate} over ${c.termYears} years ${tail}`;
}

/** "£24,000 above what you can pay" / "Within what you can pay"; null when there is nothing to compare. */
export function gapLine(asking: number | null, c: PayCeiling): string | null {
  if (asking === null || !Number.isFinite(asking) || asking <= 0) return null;
  if (c.state === 'any') return 'Within what you can pay';
  if (c.state === 'none') return null;
  if (asking <= c.amount!) return 'Within what you can pay';
  const over = asking - c.amount!;
  return c.kind === 'rent' ? `${gbp(over)} a month above what you can pay` : `${gbp(over)} above what you can pay`;
}

/** A price-drop alert's line: "Now £6,000 above what you can pay" / "Now within what you can pay". */
export function alertGapLine(asking: number | null, c: PayCeiling): string | null {
  const line = gapLine(asking, c);
  if (!line) return null;
  return line === 'Within what you can pay' ? 'Now within what you can pay' : `Now ${line}`;
}

/** They said they buy with cash (the buying path's funding answer): nothing is borrowed. */
export function cashBuyerOf(goals: MarketGoals | null | undefined): boolean {
  return Boolean(goals && goals.buyer.funding === 'cash' && (goals.path === 'buy' || goals.path === null));
}

/**
 * The member's finance as their own figures use it: a cash buyer borrows
 * nothing (a 100% deposit), so no mortgage comes off their profit and their
 * cash needed is the whole price. The profit range, the minimum-profit
 * must-have and "Most you can pay" all read it, so they can never disagree.
 * Null without goals: the house figures.
 */
export function memberFinance(goals: MarketGoals | null | undefined): MarketGoals['finance'] | null {
  if (!goals) return null;
  return cashBuyerOf(goals) ? { ...goals.finance, depositPct: 100 } : goals.finance;
}

/**
 * From a deal already worked out (a Full analysis, a report's PDF, a
 * checked or shared listing): on that deal's own income. `finance`: whose
 * deposit, rate and term (the deal's own when absent, the house figures for
 * a public page); `minProfitPcm`: the member's minimum, else the £500
 * fallback.
 */
export function mostYouCanPayForDeal(d: Deal, opts: { minProfitPcm?: number | null; finance?: Partial<FinanceDefaults> | null; house?: boolean; cashBuyer?: boolean; basis: 'exact' | 'listing' }): PayCeiling {
  const minProfit = opts.minProfitPcm ?? (d.kind === 'rent-to-rent' && !opts.house ? d.targetMarginPcm : TAILORING.fallbackMinProfitPcm);
  const own = d.kind === 'purchase' ? { depositPct: d.depositPct, mortgageRatePct: d.mortgageRatePct, termYears: d.termYears } : {};
  const fin = { ...DEFAULT_FINANCE, ...(opts.house ? {} : own), ...(opts.finance ?? {}) };
  const depositPct = opts.cashBuyer ? 100 : fin.depositPct;
  const base = { kind: d.kind === 'purchase' ? ('sale' as const) : ('rent' as const), minProfitPcm: minProfit, depositPct, mortgageRatePct: fin.mortgageRatePct, termYears: fin.termYears, basis: opts.basis, house: Boolean(opts.house) };
  if (d.kind === 'rent-to-rent') {
    const step = ROUND_TO['rent-to-rent'];
    const amount = Math.floor(maxRentForMargin(d.monthlyNetBeforeRent, minProfit) / step) * step;
    return amount > 0 ? { ...base, state: 'price', amount } : { ...base, state: 'none', amount: null };
  }
  const r = maxPriceForProfit(d.netOperating, minProfit, depositPct, fin.mortgageRatePct, fin.termYears);
  if ('none' in r) return { ...base, state: 'none', amount: null };
  if ('any' in r) return { ...base, state: 'any', amount: null };
  const step = ROUND_TO.purchase;
  const amount = Math.floor(r.price / step) * step;
  return amount > 0 ? { ...base, state: 'price', amount } : { ...base, state: 'none', amount: null };
}
