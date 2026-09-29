/**
 * Deal economics for a specific listing — pure arithmetic on figures the
 * analyser already produces. Two views:
 *
 *   purchase      the member would BUY the property (asking price is the
 *                 cost base): yield on cost, stamp duty, cash needed,
 *                 cash-on-cash, the maximum price that still hits a yield target.
 *   rent-to-rent  the member would RENT it from a landlord and sub-let it:
 *                 monthly margin after rent, bills and management, breakeven
 *                 occupancy, payback of setup cost, the maximum rent that still
 *                 leaves a target margin.
 *
 * Cost assumptions mirror src/lib/analysis.ts (15% platform, 15% management,
 * 18% cleaning ⇒ 52% net of gross) unless overridden by the expenses panel.
 */

import { stampDutyLocal, type StampDutyFigure, type TaxCountry, type TaxName } from './stamp-duty.ts';
import type { BillsSplit, CouncilTaxFigure } from './bills.ts';
import type { MortgageRateInfo, MortgageRateSource, LiveMortgageRate } from './mortgage-rate.ts';
import { auctionCash, auctionPrice, DEFAULT_AUCTION_TERMS, type AuctionMethod, type AuctionTerms } from '../deal-quality/auction.ts';

/**
 * How the purchase mortgage is paid (Batch 16b). Investors borrow
 * interest-only: the monthly payment is the interest alone and the loan is
 * repaid when the property is sold or refinanced. The repayment
 * (amortising) formula is kept behind this setting; nothing selects it today.
 */
export type MortgageType = 'interest_only' | 'repayment';

export interface FinanceDefaults {
  depositPct: number; // 25
  mortgageRatePct: number; // 5.5
  /** Only the repayment formula reads it; kept so a stored answer is never lost. */
  termYears: number; // 25
  targetYieldPct: number; // 10
  targetMarginPcm: number; // 500
  mortgageType: MortgageType; // interest_only
}

/**
 * The house finance, and the ONE place the mortgage type is set. Every deal,
 * range, ceiling, offer, report and PDF builds its finance as
 * `{ ...DEFAULT_FINANCE, ...member }`, and a member's stored finance never
 * carries a type (market/goals.ts parses five fields), so the type here is
 * the type everywhere.
 */
export const DEFAULT_FINANCE: FinanceDefaults = { depositPct: 25, mortgageRatePct: 5.5, termYears: 25, targetYieldPct: 10, targetMarginPcm: 500, mortgageType: 'interest_only' };

/** "5.5%", "5.29%": the rate as the notes print it. */
export function ratePctLabel(ratePct: number): string {
  return `${Number.isInteger(ratePct) ? ratePct : Math.round(ratePct * 100) / 100}%`;
}

/** The one sentence every surface uses to describe the purchase mortgage. */
export function MORTGAGE_NOTE(ratePct: number): string {
  return `Interest-only mortgage at ${ratePctLabel(ratePct)}: you pay the interest each month and the loan is repaid when you sell or refinance.`;
}

export interface CostRates {
  platformPct: number; // 0.15
  managementPct: number; // 0.15
  cleaningPct: number; // 0.18
  /** Monthly bills the operator pays (utilities, broadband, council tax, insurance). */
  billsPcm: number;
}

export const DEFAULT_COSTS: CostRates = { platformPct: 0.15, managementPct: 0.15, cleaningPct: 0.18, billsPcm: 250 };

export interface PurchaseDeal {
  kind: 'purchase';
  askingPrice: number;
  grossRevenue: number;
  netOperating: number; // after platform/management/cleaning and bills
  grossYieldPct: number;
  netYieldPct: number;
  stampDuty: number;
  setupCost: number;
  cashRequired: number; // deposit + stamp duty + setup
  mortgageMonthly: number;
  cashflowMonthly: number; // net operating /12 − mortgage
  cashOnCashPct: number;
  maxPriceForTargetYield: number;
  targetYieldPct: number;
  /** Finance inputs the figures were computed with, so a live panel can start from them. */
  depositPct: number;
  mortgageRatePct: number;
  termYears: number;
  /** Which formula made `mortgageMonthly` (Batch 16b). Absent on rows saved before it: those were repayment. */
  mortgageType?: MortgageType;
  // ── Added with the PropertyData deal accuracy work; absent on deals saved before it ──
  /** Which nation's transaction tax `stampDuty` is. */
  taxCountry?: TaxCountry;
  stampDutyName?: TaxName;
  stampDutyEffectiveRatePct?: number;
  /** 'propertydata' when the calculator priced it on the report date; 'local' from the published bands. */
  stampDutySource?: 'propertydata' | 'local';
  /** Where `mortgageRatePct` came from, and the market average when one was known. */
  mortgageRateSource?: MortgageRateSource;
  mortgageRateLive?: LiveMortgageRate | null;
  /** The bills line the figures used (council tax plus the fixed allowance). */
  billsPcm?: number;
  councilTax?: CouncilTaxFigure | null;
  /**
   * An auction lot (Batch 16): `askingPrice` is then the guide plus the usual
   * uplift, `cashRequired` the bridging cash, and the cash flow the member's
   * own mortgage after the refinance.
   */
  auction?: AuctionDealFigures;
}

export interface AuctionDealFigures {
  guide: number;
  method: AuctionMethod;
  premium: number;
  /** The bridging loan and the deposit it leaves to find. */
  bridgingLoan: number;
  bridgingDeposit: number;
  /** Arrangement fee plus legal and valuation. */
  bridgingFees: number;
  /** Interest over the bridge, paid off from the refinance. */
  bridgingInterest: number;
  bridgingMonths: number;
}

export interface RentToRentDeal {
  kind: 'rent-to-rent';
  advertisedRentPcm: number;
  grossRevenue: number;
  monthlyGross: number;
  monthlyOperating: number; // platform + management + cleaning + bills
  monthlyNetBeforeRent: number;
  monthlyMargin: number;
  annualMargin: number;
  breakevenOccupancyPct: number | null;
  setupCost: number;
  paybackMonths: number | null;
  maxRentForTargetMargin: number;
  targetMarginPcm: number;
  /** The bills line the figures used; absent on deals saved before it was itemised. */
  billsPcm?: number;
  councilTax?: CouncilTaxFigure | null;
}

export type Deal = PurchaseDeal | RentToRentDeal;

export interface DealInputs {
  grossRevenue: number; // annual STR gross from the estimate
  adr: number;
  bedrooms: number;
  costs?: Partial<CostRates>;
  finance?: Partial<FinanceDefaults>;
  setupCost?: number;
  /** Nation for the local tax bands when no calculator figure is supplied. */
  country?: TaxCountry;
  /** PropertyData's figure for this price, used verbatim when given. */
  stampDuty?: StampDutyFigure;
  mortgageRate?: MortgageRateInfo;
  /** Bills from the council tax band. An explicit `costs.billsPcm` (the live panel's field) still wins. */
  bills?: BillsSplit & { councilTax: CouncilTaxFigure | null };
}

/** Rough furnishing/setup budget by size; the setup calculator refines it. */
export function defaultSetupCost(bedrooms: number): number {
  return 6000 + Math.max(0, bedrooms) * 3500;
}

/** England & NI residential SDLT at the additional-property rates. Kept for callers that only know a price. */
export function stampDutyAdditional(price: number): number {
  return stampDutyLocal(price, 'england').amount;
}

function billsFor(input: DealInputs): CostRates {
  return { ...DEFAULT_COSTS, ...(input.bills ? { billsPcm: input.bills.billsPcm } : {}), ...input.costs };
}

/**
 * Standard repayment (amortising) mortgage payment. Kept behind the
 * `mortgageType` setting; `mortgagePayment` is what the deals call.
 */
export function monthlyMortgage(principal: number, annualRatePct: number, termYears: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = Math.max(1, Math.round(termYears * 12));
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/** Interest-only mortgage payment: the loan × the annual rate ÷ 12. */
export function interestOnlyMortgage(principal: number, annualRatePct: number): number {
  if (principal <= 0) return 0;
  return (principal * annualRatePct) / 100 / 12;
}

/**
 * The monthly mortgage payment on a purchase, by the finance's mortgage type.
 * The one function the deal maths, Batch 17's refinance and Batch 28's
 * buy-to-let read; the inverse is maxPriceForProfit.
 */
export function mortgagePayment(principal: number, fin: Pick<FinanceDefaults, 'mortgageRatePct' | 'termYears' | 'mortgageType'>): number {
  return fin.mortgageType === 'repayment' ? monthlyMortgage(principal, fin.mortgageRatePct, fin.termYears) : interestOnlyMortgage(principal, fin.mortgageRatePct);
}

function operatingCosts(grossRevenue: number, c: CostRates): number {
  return grossRevenue * (c.platformPct + c.managementPct + c.cleaningPct) + c.billsPcm * 12;
}

export function purchaseDeal(askingPrice: number, input: DealInputs): PurchaseDeal {
  const costs = billsFor(input);
  const fin = { ...DEFAULT_FINANCE, ...input.finance };
  const gross = Math.max(0, input.grossRevenue);
  const netOperating = gross - operatingCosts(gross, costs);
  const sd = input.stampDuty ?? stampDutyLocal(askingPrice, input.country ?? 'england');
  const stampDuty = sd.amount;
  const setupCost = input.setupCost ?? defaultSetupCost(input.bedrooms);
  const deposit = askingPrice * (fin.depositPct / 100);
  const loan = askingPrice - deposit;
  const mortgage = mortgagePayment(loan, fin);
  const cashRequired = deposit + stampDuty + setupCost;
  const cashflowMonthly = netOperating / 12 - mortgage;
  return {
    kind: 'purchase',
    askingPrice,
    grossRevenue: Math.round(gross),
    netOperating: Math.round(netOperating),
    grossYieldPct: askingPrice > 0 ? round1((gross / askingPrice) * 100) : 0,
    netYieldPct: askingPrice > 0 ? round1((netOperating / askingPrice) * 100) : 0,
    stampDuty,
    setupCost,
    cashRequired: Math.round(cashRequired),
    mortgageMonthly: Math.round(mortgage),
    cashflowMonthly: Math.round(cashflowMonthly),
    cashOnCashPct: cashRequired > 0 ? round1(((cashflowMonthly * 12) / cashRequired) * 100) : 0,
    maxPriceForTargetYield: maxPriceForYield(gross, fin.targetYieldPct),
    targetYieldPct: fin.targetYieldPct,
    depositPct: fin.depositPct,
    mortgageRatePct: fin.mortgageRatePct,
    termYears: fin.termYears,
    mortgageType: fin.mortgageType,
    taxCountry: sd.country,
    stampDutyName: sd.name,
    stampDutyEffectiveRatePct: sd.effectiveRatePct,
    stampDutySource: sd.source,
    mortgageRateSource: input.mortgageRate?.source,
    mortgageRateLive: input.mortgageRate?.live ?? null,
    billsPcm: costs.billsPcm,
    councilTax: input.bills?.councilTax ?? null,
  };
}

/**
 * An auction lot at its guide: bought at the guide plus the usual uplift,
 * with the auction house's premium, completed on a bridging loan and then
 * refinanced onto the member's own mortgage. Stamp duty is on the price
 * (the premium is not part of it). Cash required is the bridging cash
 * (deposit at the bridging LTV, stamp duty, premium, bridging fees, setup);
 * the cash flow is the member's mortgage on the price. See
 * ../deal-quality/auction.ts for the terms.
 */
export function auctionDeal(guide: number, method: AuctionMethod, input: DealInputs, terms: AuctionTerms = DEFAULT_AUCTION_TERMS): PurchaseDeal {
  const price = auctionPrice(guide, terms);
  const deal = purchaseDeal(price, input);
  const cash = auctionCash(price, deal.stampDuty, deal.setupCost, method, terms);
  return {
    ...deal,
    cashRequired: cash.cashRequired,
    cashOnCashPct: cash.cashRequired > 0 ? round1(((deal.cashflowMonthly * 12) / cash.cashRequired) * 100) : 0,
    auction: {
      guide,
      method,
      premium: cash.premium,
      bridgingLoan: cash.loan,
      bridgingDeposit: cash.deposit,
      bridgingFees: cash.fees,
      bridgingInterest: cash.interest,
      bridgingMonths: terms.termMonths,
    },
  };
}

/**
 * The most a buyer can pay and still keep `minProfitPcm` a month after the
 * mortgage (Batch 14): the exact inverse of mortgagePayment.
 *
 *   payment = net operating ÷ 12 − minimum profit     (≤ 0: no price does it)
 *   loan    = payment ÷ r                              interest-only (r = 0: any price)
 *           = payment × (1 − (1 + r)^−n) ÷ r           repayment (r = 0: payment × n)
 *   price   = loan ÷ (1 − deposit)
 *
 * A 100% deposit borrows nothing, so no price is too high for the profit:
 * `any`; so is a 0% interest-only rate. Never 0 and never negative: `none`
 * when no price leaves the profit. Not rounded: the caller rounds down, so
 * the rounded figure still clears it.
 */
export function maxPriceForProfit(netOperatingAnnual: number, minProfitPcm: number, depositPct: number, ratePct: number, termYears: number, mortgageType: MortgageType = DEFAULT_FINANCE.mortgageType): { price: number } | { none: true } | { any: true } {
  const payment = netOperatingAnnual / 12 - minProfitPcm;
  if (!Number.isFinite(payment) || payment <= 0) return { none: true };
  if (depositPct >= 100) return { any: true };
  const r = ratePct / 100 / 12;
  let loan: number;
  if (mortgageType === 'repayment') {
    const n = Math.max(1, Math.round(termYears * 12));
    loan = r === 0 ? payment * n : (payment * (1 - Math.pow(1 + r, -n))) / r;
  } else {
    if (r <= 0) return { any: true };
    loan = payment / r;
  }
  const price = loan / (1 - Math.max(0, depositPct) / 100);
  return Number.isFinite(price) && price > 0 ? { price } : { none: true };
}

/**
 * A stored deal at the current mortgage type (Batch 16b). Rows saved before
 * the type existed were priced on a repayment mortgage; this rebuilds the
 * three figures that depend on the payment from the fields every stored
 * purchase deal carries, and stamps the type. Everything else is kept as
 * saved (a lot's bridging cash, a report's basis and minimum profit), and a
 * rent-to-rent or already-current deal comes back as the same object, and so
 * does a row too old to carry the figures (nothing to rebuild from). Within
 * £1 of a fresh purchaseDeal: the stored net operating is rounded.
 */
export function atCurrentMortgage<T extends Deal>(deal: T): T {
  if (deal.kind !== 'purchase' || deal.mortgageType === DEFAULT_FINANCE.mortgageType) return deal;
  if (![deal.askingPrice, deal.depositPct, deal.mortgageRatePct, deal.termYears, deal.netOperating, deal.cashRequired].every((n) => typeof n === 'number' && Number.isFinite(n))) return deal;
  const fin = { mortgageRatePct: deal.mortgageRatePct, termYears: deal.termYears, mortgageType: DEFAULT_FINANCE.mortgageType };
  const loan = deal.askingPrice * (1 - deal.depositPct / 100);
  const mortgage = mortgagePayment(loan, fin);
  const cashflowMonthly = deal.netOperating / 12 - mortgage;
  return {
    ...deal,
    mortgageMonthly: Math.round(mortgage),
    cashflowMonthly: Math.round(cashflowMonthly),
    cashOnCashPct: deal.cashRequired > 0 ? round1(((cashflowMonthly * 12) / deal.cashRequired) * 100) : 0,
    mortgageType: DEFAULT_FINANCE.mortgageType,
  };
}

/** Highest price at which gross revenue / price still meets the target yield. */
export function maxPriceForYield(grossRevenue: number, targetYieldPct: number): number {
  if (targetYieldPct <= 0) return 0;
  return Math.round(grossRevenue / (targetYieldPct / 100));
}

export function rentToRentDeal(advertisedRentPcm: number, input: DealInputs): RentToRentDeal {
  const costs = billsFor(input);
  const fin = { ...DEFAULT_FINANCE, ...input.finance };
  const gross = Math.max(0, input.grossRevenue);
  const monthlyGross = gross / 12;
  const monthlyOperating = operatingCosts(gross, costs) / 12;
  const monthlyNetBeforeRent = monthlyGross - monthlyOperating;
  const monthlyMargin = monthlyNetBeforeRent - advertisedRentPcm;
  const setupCost = input.setupCost ?? defaultSetupCost(input.bedrooms);
  const variablePct = costs.platformPct + costs.managementPct + costs.cleaningPct;
  // Occupancy at which net (after variable costs, bills and rent) is zero: ADR·365·occ·(1−v) = rent·12 + bills·12
  const breakeven =
    input.adr > 0 && variablePct < 1 ? ((advertisedRentPcm + costs.billsPcm) * 12) / (input.adr * 365 * (1 - variablePct)) : null;
  return {
    kind: 'rent-to-rent',
    advertisedRentPcm,
    grossRevenue: Math.round(gross),
    monthlyGross: Math.round(monthlyGross),
    monthlyOperating: Math.round(monthlyOperating),
    monthlyNetBeforeRent: Math.round(monthlyNetBeforeRent),
    monthlyMargin: Math.round(monthlyMargin),
    annualMargin: Math.round(monthlyMargin * 12),
    breakevenOccupancyPct: breakeven === null ? null : Math.round(Math.min(1.5, breakeven) * 1000) / 10,
    setupCost,
    paybackMonths: monthlyMargin > 0 ? Math.ceil(setupCost / monthlyMargin) : null,
    maxRentForTargetMargin: maxRentForMargin(monthlyNetBeforeRent, fin.targetMarginPcm),
    targetMarginPcm: fin.targetMarginPcm,
    billsPcm: costs.billsPcm,
    councilTax: input.bills?.councilTax ?? null,
  };
}

/** Highest rent that still leaves the target monthly margin. */
export function maxRentForMargin(monthlyNetBeforeRent: number, targetMarginPcm: number): number {
  return Math.max(0, Math.round(monthlyNetBeforeRent - targetMarginPcm));
}

export interface CashflowMonth {
  month: number; // 1–12
  revenue: number;
  operating: number;
  fixed: number; // rent or mortgage
  net: number;
  underwater: boolean;
}

/** Month-by-month cashflow against a fixed monthly outgoing (rent or mortgage). */
export function monthlyCashflow(monthlyRevenue: number[], fixedPcm: number, costs: Partial<CostRates> = {}): CashflowMonth[] {
  const c = { ...DEFAULT_COSTS, ...costs };
  const variablePct = c.platformPct + c.managementPct + c.cleaningPct;
  return monthlyRevenue.slice(0, 12).map((rev, i) => {
    const revenue = Math.max(0, rev);
    const operating = revenue * variablePct + c.billsPcm;
    const net = revenue - operating - fixedPcm;
    return { month: i + 1, revenue: Math.round(revenue), operating: Math.round(operating), fixed: Math.round(fixedPcm), net: Math.round(net), underwater: net < 0 };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
