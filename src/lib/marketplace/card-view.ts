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
import { profitRange, upliftTag, type ProfitRange } from './profit-range.ts';
import { analysisQuote } from '../analysis/deal-analysis-rules.ts';
import type { DealPricing, PriceLabel } from '../credit/deal-pricing.ts';
import type { FinanceDefaults } from '../listing/deal.ts';
import type { DealCard } from './grid.ts';

export interface CardState {
  /** Open to the member's account (theirs or a teammate's open). */
  opened: boolean;
  /** What the account paid to open it, base pence. */
  openPaidBasePence: number;
  /** A Full analysis (or full report) the member can open. */
  reportId: string | null;
}

export const NOT_OPENED: CardState = { opened: false, openPaidBasePence: 0, reportId: null };

export interface CardView {
  range: ProfitRange | null;
  /** "+45% vs a long let", purchases only. */
  uplift: string | null;
  opened: boolean;
  analysed: boolean;
  reportId: string | null;
  /** Unopened only. */
  quickLook: PriceLabel | null;
  /** The one-tap total when unopened, the difference when opened; null once analysed. */
  fullAnalysis: PriceLabel | null;
  fullAnalysisBasePence: number;
}

export function cardView(input: {
  card: Pick<DealCard, 'kind' | 'price_amount' | 'price_period' | 'bedrooms' | 'annual_profit' | 'uplift_pct' | 'screening_gross' | 'screening_confidence'>;
  state: CardState;
  admin: boolean;
  pricing: Pick<DealPricing, 'fullAnalysisPence' | 'pmiAddonPence' | 'profitRangePct'>;
  ladder: DealOpenLadder;
  finance?: Partial<FinanceDefaults> | null;
  label: (basePence: number) => PriceLabel;
}): CardView {
  const { card, state } = input;
  const range = profitRange({
    kind: card.kind,
    priceAmount: card.price_amount,
    pricePeriod: card.price_period,
    bedrooms: card.bedrooms,
    grossRevenue: card.screening_gross ?? null,
    confidence: card.screening_confidence ?? null,
    finance: input.finance ?? null,
    widths: input.pricing.profitRangePct,
  });
  const analysed = state.reportId !== null;
  const ladderPence = openPricePence(card.annual_profit === null ? null : Number(card.annual_profit), input.ladder);
  const quote = analysisQuote({ admin: input.admin, pricing: input.pricing, opened: state.opened, openPaidBasePence: state.openPaidBasePence, openPricePence: ladderPence, withPmi: false });
  return {
    range,
    uplift: card.kind === 'sale' ? upliftTag(card.uplift_pct) : null,
    opened: state.opened,
    analysed,
    reportId: state.reportId,
    quickLook: state.opened ? null : input.label(input.admin ? 0 : ladderPence),
    fullAnalysis: analysed ? null : input.label(quote.due.purchaseBasePence),
    fullAnalysisBasePence: quote.due.purchaseBasePence,
  };
}
