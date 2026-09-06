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

export interface FinanceDefaults {
  depositPct: number; // 25
  mortgageRatePct: number; // 5.5
  termYears: number; // 25
  targetYieldPct: number; // 10
  targetMarginPcm: number; // 500
}

export const DEFAULT_FINANCE: FinanceDefaults = { depositPct: 25, mortgageRatePct: 5.5, termYears: 25, targetYieldPct: 10, targetMarginPcm: 500 };

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
}

export type Deal = PurchaseDeal | RentToRentDeal;

export interface DealInputs {
  grossRevenue: number; // annual STR gross from the estimate
  adr: number;
  bedrooms: number;
  costs?: Partial<CostRates>;
  finance?: Partial<FinanceDefaults>;
  setupCost?: number;
}

/** Rough furnishing/setup budget by size; the setup calculator refines it. */
export function defaultSetupCost(bedrooms: number): number {
  return 6000 + Math.max(0, bedrooms) * 3500;
}

/** England & NI residential SDLT (additional-property rates, from 1 Apr 2025). */
export function stampDutyAdditional(price: number): number {
  const bands: [number, number][] = [
    [125_000, 0.05],
    [250_000, 0.07],
    [925_000, 0.10],
    [1_500_000, 0.15],
    [Infinity, 0.17],
  ];
  let duty = 0;
  let lower = 0;
  for (const [upper, rate] of bands) {
    if (price <= lower) break;
    const slice = Math.min(price, upper) - lower;
    duty += slice * rate;
    lower = upper;
  }
  return Math.round(duty);
}

/** Standard repayment mortgage payment. */
export function monthlyMortgage(principal: number, annualRatePct: number, termYears: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = Math.max(1, Math.round(termYears * 12));
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function operatingCosts(grossRevenue: number, c: CostRates): number {
  return grossRevenue * (c.platformPct + c.managementPct + c.cleaningPct) + c.billsPcm * 12;
}

export function purchaseDeal(askingPrice: number, input: DealInputs): PurchaseDeal {
  const costs = { ...DEFAULT_COSTS, ...input.costs };
  const fin = { ...DEFAULT_FINANCE, ...input.finance };
  const gross = Math.max(0, input.grossRevenue);
  const netOperating = gross - operatingCosts(gross, costs);
  const stampDuty = stampDutyAdditional(askingPrice);
  const setupCost = input.setupCost ?? defaultSetupCost(input.bedrooms);
  const deposit = askingPrice * (fin.depositPct / 100);
  const loan = askingPrice - deposit;
  const mortgage = monthlyMortgage(loan, fin.mortgageRatePct, fin.termYears);
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
  };
}

/** Highest price at which gross revenue / price still meets the target yield. */
export function maxPriceForYield(grossRevenue: number, targetYieldPct: number): number {
  if (targetYieldPct <= 0) return 0;
  return Math.round(grossRevenue / (targetYieldPct / 100));
}

export function rentToRentDeal(advertisedRentPcm: number, input: DealInputs): RentToRentDeal {
  const costs = { ...DEFAULT_COSTS, ...input.costs };
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
