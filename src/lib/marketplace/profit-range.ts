/**
 * A deal's profit as an AREA-ESTIMATE RANGE at the member's own finance: what
 * cards, the deal sheet, My deals, the public pages and the emails show. The
 * exact figure for the property is what a Full analysis is bought for, so it
 * is never shown before one.
 *
 * The middle of the range is the deal model the Full analysis itself uses
 * (src/lib/listing/deal.ts) run on the screening's short-let revenue for the
 * area and size: for a purchase, the monthly cash flow after the mortgage at
 * the member's deposit and rate; for rent-to-rent, the monthly margin after
 * the advertised rent. Its half-width is the screening's confidence
 * (billing_settings.profit_range_pct: high ±10%, medium ±15%, low ±25%,
 * never wider than ±25%) taken on that monthly profit, and each end is
 * rounded to £10.
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { purchaseDeal, rentToRentDeal, type FinanceDefaults } from '../listing/deal.ts';
import { MAX_RANGE_PCT } from '../credit/deal-pricing.ts';
import { parseScreening } from '../listing/screen.ts';
import { cashLine } from '../deal-quality/streams.ts';

export type RangeConfidence = 'high' | 'medium' | 'low';

export interface ProfitRange {
  kind: 'purchase' | 'rent-to-rent';
  /** The model's monthly figure, never shown on its own. */
  midPcm: number;
  lowPcm: number;
  highPcm: number;
  /** Half-width used, in percent. */
  pct: number;
  /** "£450–£700/mo", "−£150 to £50/mo". */
  label: string;
  /** "cash flow after the mortgage" / "profit after rent", for a caption. */
  basis: string;
}

export interface ProfitRangeInput {
  kind: 'sale' | 'rent';
  priceAmount: number | string | null;
  pricePeriod: string | null;
  bedrooms: number | null;
  /** The screening's short-let revenue for the area and size, £/yr. */
  grossRevenue: number | string | null;
  confidence: string | null;
  /** The member's saved finance; the house defaults without one. */
  finance?: Partial<FinanceDefaults> | null;
  widths: { high: number; medium: number; low: number };
}

const STEP = 10;

const money = (n: number): string => {
  const r = Math.round(n);
  return `${r < 0 ? '−' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
};

/** "£450–£700/mo"; with a negative end, "−£150 to £50/mo" so the dash cannot read as a minus. */
export function formatRange(lowPcm: number, highPcm: number): string {
  return lowPcm < 0 || highPcm < 0 ? `${money(lowPcm)} to ${money(highPcm)}/mo` : `${money(lowPcm)}–${money(highPcm)}/mo`;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rentPcmOf(amount: number, period: string | null): number | null {
  if (period === 'pcm') return amount;
  if (period === 'pw') return (amount * 52) / 12;
  return null;
}

export function widthFor(confidence: string | null, widths: ProfitRangeInput['widths']): number {
  const c: RangeConfidence = confidence === 'high' || confidence === 'medium' ? confidence : 'low';
  const pct = Number(widths[c]);
  return Math.min(MAX_RANGE_PCT, Math.max(0, Number.isFinite(pct) ? pct : MAX_RANGE_PCT));
}

export function profitRange(input: ProfitRangeInput): ProfitRange | null {
  const gross = num(input.grossRevenue);
  const price = num(input.priceAmount);
  if (gross === null || gross <= 0 || price === null || price <= 0) return null;
  const base = { grossRevenue: gross, adr: 0, bedrooms: input.bedrooms ?? 2, finance: input.finance ?? undefined };
  let mid: number;
  let kind: ProfitRange['kind'];
  if (input.kind === 'rent') {
    const rent = rentPcmOf(price, input.pricePeriod);
    if (rent === null) return null;
    mid = rentToRentDeal(rent, base).monthlyMargin;
    kind = 'rent-to-rent';
  } else {
    if (input.pricePeriod !== null && input.pricePeriod !== 'total') return null;
    mid = purchaseDeal(price, base).cashflowMonthly;
    kind = 'purchase';
  }
  const pct = widthFor(input.confidence, input.widths);
  // At least one £10 step either side, so a deal that breaks even still reads as a range.
  const half = Math.max(STEP, (Math.abs(mid) * pct) / 100);
  const lowPcm = Math.round((mid - half) / STEP) * STEP;
  const highPcm = Math.round((mid + half) / STEP) * STEP;
  return { kind, midPcm: Math.round(mid), lowPcm, highPcm, pct, label: formatRange(lowPcm, highPcm), basis: kind === 'purchase' ? 'cash flow after the mortgage' : 'profit after rent' };
}

/**
 * The caption under a range (Batch 16, Part C): the deal's own comparables
 * when it has been checked — the count only, never the radius or a place —
 * else the area estimate, as before.
 */
export function rangeCaption(compCount: number | string | null | undefined): string {
  const n = num(compCount);
  return n !== null && n > 0 ? `based on ${n} similar Airbnb${n === 1 ? '' : 's'} nearby` : 'area estimate';
}

/** "+45% vs a long let": kept beside a purchase's range as a small tag. */
export function upliftTag(upliftPct: number | string | null | undefined): string | null {
  const u = num(upliftPct);
  if (u === null) return null;
  return `${u >= 0 ? '+' : '−'}${Math.abs(Math.round(u))}% vs a long let`;
}

/**
 * Any other figure that rests on the area's short-let income (yield, net
 * operating, cash on cash, the most to pay), shown with the same half-width
 * as the profit: [low, high], each end rounded to `step`.
 */
export function spread(value: number, pct: number, step: number): [number, number] {
  const half = (Math.abs(value) * Math.min(MAX_RANGE_PCT, Math.max(0, pct))) / 100;
  const r = (n: number) => Math.round(n / step) * step;
  return [r(value - half), r(value + half)];
}

/** "£5,400–£7,300", "−£1,200 to £300": a money range for a figure the page labels itself. */
export function moneyRange([low, high]: [number, number]): string {
  return low < 0 || high < 0 ? `${money(low)} to ${money(high)}` : `${money(low)}–${money(high)}`;
}

/** The range for a stored deal (its screening JSON on the row), e.g. a marketplace_deals row or a pick. */
export function rangeFromScreening(deal: { kind: 'sale' | 'rent'; price_amount: number | string | null; price_period: string | null; bedrooms: number | null; screening: unknown }, finance: ProfitRangeInput['finance'], widths: ProfitRangeInput['widths']): ProfitRange | null {
  const s = parseScreening(deal.screening);
  return profitRange({ kind: deal.kind, priceAmount: deal.price_amount, pricePeriod: deal.price_period, bedrooms: deal.bedrooms, grossRevenue: s?.grossRevenue?.value ?? null, confidence: s?.confidence ?? null, finance, widths });
}

/**
 * A card's range as an email line: "£450–£700/mo · area estimate · £38k
 * cash in" (or "· based on 12 similar Airbnbs nearby" once the deal has
 * been checked), or null when there is none to show. The cash in (Batch
 * 16) is the house-finance figure the card row carries (deal_cash /
 * deal_setup); a card read without those columns has no cash line.
 */
export function cardRangeLine(card: { kind: 'sale' | 'rent'; price_amount: number | string | null; price_period: string | null; bedrooms: number | null; screening_gross?: number | string | null; screening_confidence?: string | null; deal_cash?: number | string | null; deal_setup?: number | string | null; check_comps?: number | string | null }, finance: ProfitRangeInput['finance'], widths: ProfitRangeInput['widths']): string | null {
  const r = profitRange({ kind: card.kind, priceAmount: card.price_amount, pricePeriod: card.price_period, bedrooms: card.bedrooms, grossRevenue: card.screening_gross ?? null, confidence: card.screening_confidence ?? null, finance, widths });
  if (!r) return null;
  const cash = cashLine(card.kind, card.kind === 'rent' ? card.deal_setup : card.deal_cash);
  return `${r.label} · ${rangeCaption(card.check_comps)}${cash ? ` · ${cash}` : ''}`;
}
