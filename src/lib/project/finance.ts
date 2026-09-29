/**
 * Finance and time for a project (Part E2, decided; Q8 on 29 Sep). The aim is
 * only to show the deal stacks up, not to model finance in depth.
 *
 *   LIGHT REFRESH  financed as today: the member's deposit and mortgage on
 *                  the price. Two months of works with no short-let income:
 *                  the bills run (£250 a month, council tax included); the
 *                  mortgage payments are not counted as holding.
 *   FULL PROJECT   bought on a bridge at Batch 16's auction_model terms (one
 *                  set of terms, not a second): the bridge lends 70% of the
 *                  price, the works are paid in cash, the arrangement fee
 *                  counts, the bridge's own legal and valuation does not (the
 *                  £3,500 buying costs cover it). Four months of works (six
 *                  from 4 bedrooms) with the bridge's interest and the bills
 *                  running. Then refinanced at 75% of the value after works
 *                  onto the member's own mortgage; the bridge is repaid from
 *                  it, and what is left in is the headline.
 *
 *   money in (for the value test) = price + stamp duty + buying costs +
 *     works + holding; furnishing (the existing £6,000 + £3,500 a bedroom) is
 *     for the short let, not the resale value, so it stays out of the test
 *     and goes into the total in, the cash needed and the money left in.
 *
 * Every figure is a range over the works range (low / high end).
 *
 * Pure: no network, no database, no server-only.
 */

import { DEFAULT_COSTS, DEFAULT_FINANCE, defaultSetupCost, mortgagePayment, purchaseDeal, type FinanceDefaults } from '../listing/deal.ts';
import { stampDutyLocal, type TaxCountry, type TaxName } from '../listing/stamp-duty.ts';
import { DEFAULT_AUCTION_TERMS, type AuctionTerms } from '../deal-quality/auction.ts';
import { formatRange, widthFor, type ProfitRangeInput } from '../marketplace/profit-range.ts';
import { DEFAULT_PROJECT_COSTS, DEFAULT_PROJECT_VALUE, type ProjectCostsSettings, type ProjectValueSettings } from './config.ts';
import type { ProjectLevel } from './costing.ts';

export interface Span {
  low: number;
  high: number;
}

export interface Bridge {
  /** On the price (and the works share, when a setting lends on them), £. */
  loan: number;
  ltvPct: number;
  monthlyPct: number;
  interest: Span;
  arrangementFee: number;
  legalAndValuation: number;
}

export interface ProjectFinance {
  level: ProjectLevel;
  price: number;
  stampDuty: number;
  taxName: TaxName;
  buyingCosts: number;
  months: number;
  bridge: Bridge | null;
  billsPcm: number;
  /** Bills over the works + the bridge's costs. */
  holding: Span;
  /** Price + stamp duty + buying costs + works + holding (the value test's money in). */
  moneyIn: Span;
  furnishing: number;
  /** Money in + furnishing. */
  totalIn: Span;
  /** What the member puts in: deposit (or the bridge's), stamp duty, buying costs, works, holding, furnishing. */
  cash: Span;
  /** Full projects only. */
  refinance: { pct: number; loan: number; moneyLeftIn: Span } | null;
}

export interface FinanceInput {
  level: ProjectLevel;
  price: number;
  bedrooms: number;
  country: TaxCountry;
  works: Span;
  /** The value after works the refinance lends against. */
  value: number;
  /** The member's deposit for a light refresh; the house 25% without one. */
  depositPct?: number;
  costs?: ProjectCostsSettings;
  valueSettings?: ProjectValueSettings;
  bridging?: AuctionTerms;
  billsPcm?: number;
  setupCost?: number;
}

export function monthsFor(level: ProjectLevel, bedrooms: number, c: ProjectCostsSettings = DEFAULT_PROJECT_COSTS): number {
  if (level === 'light') return c.monthsLight;
  return bedrooms >= c.largeFromBedrooms ? c.monthsFullLarge : c.monthsFull;
}

const round = (n: number) => Math.round(n);

export function projectFinance(input: FinanceInput): ProjectFinance {
  const c = input.costs ?? DEFAULT_PROJECT_COSTS;
  const v = input.valueSettings ?? DEFAULT_PROJECT_VALUE;
  const t = input.bridging ?? DEFAULT_AUCTION_TERMS;
  const billsPcm = input.billsPcm ?? DEFAULT_COSTS.billsPcm;
  const price = input.price;
  const sd = stampDutyLocal(price, input.country);
  const months = monthsFor(input.level, input.bedrooms, c);
  const bills = billsPcm * months;
  const furnishing = input.setupCost ?? defaultSetupCost(input.bedrooms);
  const works = { low: round(input.works.low), high: round(input.works.high) };

  let bridge: Bridge | null = null;
  let buyingCosts: number;
  let holding: Span;
  let cash: Span;
  if (input.level === 'full') {
    buyingCosts = c.buyingCostsBridging;
    const onPrice = price * (t.bridgingLtvPct / 100);
    const worksShare = Math.max(0, Math.min(100, c.bridgeWorksPct)) / 100;
    const loanFor = (w: number) => onPrice + w * worksShare;
    const interestFor = (w: number) => loanFor(w) * (t.bridgingMonthlyPct / 100) * months;
    const arrangementFor = (w: number) => (c.arrangementFee ? loanFor(w) * (t.arrangementPct / 100) : 0);
    const legal = c.legalAndValuation ? t.legalAndValuation : 0;
    bridge = {
      loan: round(loanFor(works.high)),
      ltvPct: t.bridgingLtvPct,
      monthlyPct: t.bridgingMonthlyPct,
      interest: { low: round(interestFor(works.low)), high: round(interestFor(works.high)) },
      arrangementFee: round(arrangementFor(works.high)),
      legalAndValuation: legal,
    };
    const holdFor = (w: number) => bills + interestFor(w) + arrangementFor(w) + legal;
    holding = { low: round(holdFor(works.low)), high: round(holdFor(works.high)) };
    const cashFor = (w: number, h: number) => price - onPrice + sd.amount + buyingCosts + w * (1 - worksShare) + h + furnishing;
    cash = { low: round(cashFor(works.low, holding.low)), high: round(cashFor(works.high, holding.high)) };
  } else {
    buyingCosts = c.buyingCosts;
    holding = { low: round(bills), high: round(bills) };
    const depositPct = Number.isFinite(input.depositPct) ? Math.max(0, Math.min(100, input.depositPct!)) : DEFAULT_FINANCE.depositPct;
    const deposit = price * (depositPct / 100);
    cash = { low: round(deposit + sd.amount + buyingCosts + works.low + holding.low + furnishing), high: round(deposit + sd.amount + buyingCosts + works.high + holding.high + furnishing) };
  }

  const moneyIn = { low: round(price + sd.amount + buyingCosts + works.low + holding.low), high: round(price + sd.amount + buyingCosts + works.high + holding.high) };
  const totalIn = { low: moneyIn.low + furnishing, high: moneyIn.high + furnishing };
  const refinance =
    input.level === 'full'
      ? (() => {
          const loan = round(input.value * (v.refinancePct / 100));
          return { pct: v.refinancePct, loan, moneyLeftIn: { low: totalIn.low - loan, high: totalIn.high - loan } };
        })()
      : null;

  return { level: input.level, price, stampDuty: sd.amount, taxName: sd.name, buyingCosts, months, bridge, billsPcm, holding, moneyIn, furnishing, totalIn, cash, refinance };
}

/**
 * The monthly short-let profit after the works, the middle of the range, at
 * the member's own finance (the house figures without them), on the same
 * mortgage as every purchase deal (Batch 16b: interest-only, through
 * mortgagePayment):
 *   light: the ordinary deal model on the price (deposit, rate);
 *   full:  after the refinance, the member's rate on 75% of the value after
 *          works.
 * The income is the deal's own (Batch 16's comparables check, or the area
 * figure until it has one); comparable Airbnbs are finished homes, so this
 * is the income after the works.
 */
export function profitAfterWorksPcm(input: { level: ProjectLevel; price: number; value: number; bedrooms: number; grossRevenue: number; finance?: Partial<FinanceDefaults> | null; refinancePct?: number }): number {
  const fin = { ...DEFAULT_FINANCE, ...(input.finance ?? {}) };
  const base = { grossRevenue: input.grossRevenue, adr: 0, bedrooms: input.bedrooms, finance: fin };
  const deal = purchaseDeal(input.price, base);
  if (input.level === 'light') return deal.cashflowMonthly;
  const loan = input.value * ((input.refinancePct ?? DEFAULT_PROJECT_VALUE.refinancePct) / 100);
  return Math.round(deal.netOperating / 12 - mortgagePayment(loan, fin));
}

export interface ProjectProfitRange {
  midPcm: number;
  lowPcm: number;
  highPcm: number;
  pct: number;
  /** "£550–£750/mo". */
  label: string;
}

const STEP = 10;

/**
 * The same range format as every other deal (profit-range.ts): the income's
 * confidence as a half-width around the middle, each end to £10, at least one
 * step either side. The BRRR minimum-profit check reads the LOW end.
 */
export function profitAfterWorksRange(input: Parameters<typeof profitAfterWorksPcm>[0] & { confidence: string | null; widths: ProfitRangeInput['widths'] }): ProjectProfitRange | null {
  if (!Number.isFinite(input.grossRevenue) || input.grossRevenue <= 0 || !(input.price > 0)) return null;
  const mid = profitAfterWorksPcm(input);
  const pct = widthFor(input.confidence, input.widths);
  const half = Math.max(STEP, (Math.abs(mid) * pct) / 100);
  const lowPcm = Math.round((mid - half) / STEP) * STEP;
  const highPcm = Math.round((mid + half) / STEP) * STEP;
  return { midPcm: mid, lowPcm, highPcm, pct, label: formatRange(lowPcm, highPcm) };
}
