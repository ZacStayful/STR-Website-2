/**
 * What one deal card shows a particular member (Batch 10): the profit as an
 * area-estimate range at their finance, the long-let uplift tag, whether the
 * deal is open to their account or analysed, and the two price buttons at
 * what THEY pay (a top-up payer sees "£5.20 · £4 on a plan").
 *
 * Pure: the caller hands in `label` (the member's quoter, quote-server.ts).
 * Relative `.ts` imports only.
 */

import { openPricePence, type DealOpenLadder } from './ladder.ts';
import { profitRange, rangeCaption, upliftTag, widthFor, type ProfitRange } from './profit-range.ts';
import { mostYouCanPay, type PayCeiling } from './most-you-can-pay.ts';
import type { CardNumber } from '../tailoring/numbers.ts';
import type { Explanation } from '../tailoring/why.ts';
import type { Lead } from '../tailoring/about-prompts.ts';
import { analysisQuote } from '../analysis/deal-analysis-rules.ts';
import type { DealPricing, PriceLabel } from '../credit/deal-pricing.ts';
import { purchaseDeal, type FinanceDefaults } from '../listing/deal.ts';
import { countryForPostcode } from '../listing/stamp-duty.ts';
import { cashLine } from '../deal-quality/streams.ts';
import { DEFAULT_LOW_ENTRY } from '../deal-quality/config.ts';
import type { DealCard } from './grid.ts';
import { projectNumbersFor, projectOf, projectSummary } from '../project/display.ts';

export interface CardState {
  /** Open to the member's account (theirs or a teammate's open). */
  opened: boolean;
  /** What the account paid to open it, base pence. */
  openPaidBasePence: number;
  /** A Full analysis (or full report) the member can open. */
  reportId: string | null;
}

export const NOT_OPENED: CardState = { opened: false, openPaidBasePence: 0, reportId: null };

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The cash in this member sees (CardView.cash). A purchase at their own
 * deposit when they have set one (the stored figure is at the house 25%),
 * on the listing's price and its nation's tax; the stored figure otherwise,
 * and always for an auction lot, whose cash is the bridging cash. A rental:
 * its setup cost.
 */
function cashInFor(card: Pick<DealCard, 'kind' | 'price_amount' | 'price_period' | 'bedrooms' | 'screening_gross'> & Partial<Pick<DealCard, 'outcode' | 'deal_cash' | 'deal_auction' | 'deal_setup'>>, finance: Partial<FinanceDefaults> | null): number | null {
  if (card.kind === 'rent') return num(card.deal_setup);
  const stored = num(card.deal_cash);
  const price = num(card.price_amount);
  if (card.deal_auction || !finance || finance.depositPct === undefined || finance.depositPct === null || price === null || price <= 0 || (card.price_period !== null && card.price_period !== 'total')) return stored;
  const own = purchaseDeal(price, { grossRevenue: num(card.screening_gross) ?? 0, adr: 0, bedrooms: card.bedrooms ?? 2, finance, country: countryForPostcode(card.outcode ?? null) });
  return own.cashRequired;
}

export interface CardView {
  range: ProfitRange | null;
  /** Batch 16, Part C: what the range rests on — "based on 12 similar Airbnbs nearby" once checked, else "area estimate". */
  caption: string;
  /**
   * Batch 14: the most this member can pay to hit their own monthly profit,
   * on the card's income, where its range would start at their minimum.
   * Null without the screening's income.
   */
  pay: PayCeiling | null;
  /**
   * Batch 14, Part C: the three numbers for this member's role and goal
   * (src/lib/tailoring/numbers.ts), added by the page once it knows their
   * profile. Absent or null: the card draws exactly as before.
   */
  numbers?: CardNumber[] | null;
  /** Batch 14, Part D: why it is on their list, and how well it matches (src/lib/tailoring/why.ts). */
  explanation?: Explanation | null;
  /** Batch 14, Part E: "Knowing the numbers" holds them back, so the Full analysis leads (src/lib/tailoring/about-prompts.ts). */
  lead?: Lead;
  /** "+45% vs a long let", purchases only. */
  uplift: string | null;
  /**
   * Batch 16, Part F: what the deal takes to get into. A purchase's cash in
   * (deposit, tax, setup) at this member's finance when they have set it,
   * else the house figure the row carries; an auction lot's bridging cash
   * whoever looks (no deposit choice on a bridge); a rental's setup cost
   * ("£12k to start"). Null when the row has no figure.
   */
  cash: string | null;
  /** Batch 16, Part F: in the low-entry stream (the house figure within the low-entry bar). */
  lowEntry: boolean;
  /**
   * Batch 17: a Project deal's "Works ~£14k–£26k · £22k value added" (the
   * range is then its profit after works, the cash its cash needed as a
   * range, and "Most you can pay" is left off: it assumes a finished house).
   * Null for every other deal.
   */
  projectLine: string | null;
  opened: boolean;
  analysed: boolean;
  reportId: string | null;
  /** Unopened only. */
  quickLook: PriceLabel | null;
  /** The one-tap total when unopened, the difference when opened; null once analysed. */
  fullAnalysis: PriceLabel | null;
  fullAnalysisBasePence: number;
  /** Batch 22: "welcome price" / "first-time price" when the Full analysis is offer-priced. */
  offerNote?: string | null;
}

export function cardView(input: {
  card: Pick<DealCard, 'kind' | 'price_amount' | 'price_period' | 'bedrooms' | 'annual_profit' | 'uplift_pct' | 'screening_gross' | 'screening_confidence'> & Partial<Pick<DealCard, 'outcode' | 'deal_cash' | 'deal_auction' | 'deal_setup' | 'check_comps' | 'project'>>;
  state: CardState;
  admin: boolean;
  pricing: Pick<DealPricing, 'fullAnalysisPence' | 'pmiAddonPence' | 'profitRangePct'>;
  /** Batch 22: the offer the pricing above carries, for the button's note. */
  offerNote?: string | null;
  ladder: DealOpenLadder;
  finance?: Partial<FinanceDefaults> | null;
  /** They buy with cash: nothing is borrowed, so no price is too high for the profit. */
  cashBuyer?: boolean;
  /** billing_settings.low_entry maxCashIn (getBillingSettings().lowEntry); the decided default without it. */
  lowEntryMaxCashIn?: number;
  label: (basePence: number) => PriceLabel;
}): CardView {
  const { card, state } = input;
  // Batch 14: a cash buyer's range has no mortgage in it either, as "Most you can pay" has none (memberFinance).
  const finance = input.cashBuyer ? { ...(input.finance ?? {}), depositPct: 100 } : input.finance ?? null;
  const cash = cashInFor(card, finance);
  const houseCash = num(card.deal_cash);
  const range = profitRange({
    kind: card.kind,
    priceAmount: card.price_amount,
    pricePeriod: card.price_period,
    bedrooms: card.bedrooms,
    grossRevenue: card.screening_gross ?? null,
    confidence: card.screening_confidence ?? null,
    finance,
    widths: input.pricing.profitRangePct,
  });
  const analysed = state.reportId !== null;
  const ladderPence = openPricePence(card.annual_profit === null ? null : Number(card.annual_profit), input.ladder);
  const quote = analysisQuote({ admin: input.admin, pricing: input.pricing, opened: state.opened, openPaidBasePence: state.openPaidBasePence, openPricePence: ladderPence, withPmi: false });
  const pay = mostYouCanPay({ kind: card.kind, grossRevenue: card.screening_gross ?? null, bedrooms: card.bedrooms, finance: input.finance ?? null, cashBuyer: input.cashBuyer, widthPct: widthFor(card.screening_confidence ?? null, input.pricing.profitRangePct), checked: (num(card.check_comps) ?? 0) > 0 });
  // Batch 17: a Project deal shows its own numbers: profit after works, works and value added, the cash needed as a range.
  const project = projectOf(card);
  const pn = project ? projectNumbersFor(card, project, finance, input.pricing.profitRangePct) : null;
  const projectRange: ProfitRange | null = pn?.range ? { kind: 'purchase', midPcm: pn.range.midPcm, lowPcm: pn.range.lowPcm, highPcm: pn.range.highPcm, pct: pn.range.pct, label: pn.range.label, basis: 'profit after works' } : null;
  return {
    range: pn ? projectRange : range,
    caption: pn ? pn.caption : rangeCaption(card.check_comps),
    pay: pn ? null : pay,
    uplift: card.kind === 'sale' && !pn ? upliftTag(card.uplift_pct) : null,
    cash: pn ? pn.cash : cashLine(card.kind, cash),
    lowEntry: !pn && card.kind === 'sale' && houseCash !== null && houseCash > 0 && houseCash <= (input.lowEntryMaxCashIn ?? DEFAULT_LOW_ENTRY.maxCashIn),
    projectLine: pn ? projectSummary(pn) : null,
    opened: state.opened,
    analysed,
    reportId: state.reportId,
    quickLook: state.opened ? null : input.label(input.admin ? 0 : ladderPence),
    fullAnalysis: analysed ? null : input.label(quote.due.purchaseBasePence),
    fullAnalysisBasePence: quote.due.purchaseBasePence,
    offerNote: analysed ? null : input.offerNote ?? null,
  };
}
