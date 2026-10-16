/**
 * The buy-to-let maths (Batch 28, Part B): a sale listing bought with a 75%
 * interest-only mortgage at the live 2–3-year fixed rate and let to long-term
 * tenants. Every figure is a range (low / middle / high) and every figure is
 * before tax; the screens say so.
 *
 *   RUNNING COSTS   per month at a given rent: the empty month(s), the letting
 *                   agent and repairs on the rent actually collected, insurance,
 *                   safety certificates, and a flat's service charge and
 *                   ground rent. Council tax and bills are the tenant's; no
 *                   furnishing.
 *   CASHFLOW        rent − running costs − the mortgage. The low end is the low
 *                   rent with the high flat charges; the high end the reverse.
 *   CASH IN         deposit + the nation's additional-property tax (the one
 *                   helper, listing/stamp-duty.ts) + buying costs. The high
 *                   end adds the EPC upgrade allowance (D £5,000, E–G £10,000,
 *                   not checked yet: the D allowance).
 *   ROI             annual cashflow ÷ cash in: the low end over the high cash
 *                   in, the high end over the low.
 *   LENDER TEST     rent ≥ 125% of the monthly interest at the higher of the
 *                   live rate + 2% or 5.5%, at 75% LTV, tested on the middle
 *                   rent (Q3). A fail is never a BTL deal; the deal page says
 *                   what deposit would pass.
 *
 * The mortgage is Batch 16b's mortgagePayment (interest-only by the house
 * finance), never a second formula. Everything returns null rather than
 * throwing on a missing figure.
 *
 * Pure: no network, no database, no server-only.
 */

import { DEFAULT_FINANCE, mortgagePayment } from '../listing/deal.ts';
import { stampDutyLocal, type TaxCountry, type TaxName } from '../listing/stamp-duty.ts';
import { DEFAULT_BTL_BANDS, DEFAULT_BTL_COSTS, DEFAULT_BTL_EPC, DEFAULT_BTL_FINANCE, type BtlCosts, type BtlEpcSettings, type BtlFinance } from './config.ts';
import type { FlatCharges } from './listing.ts';

export interface Range3 {
  low: number;
  mid: number;
  high: number;
}

export interface BtlRentInput {
  low: number;
  mid: number;
  high: number;
}

export type EpcRating = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface BtlInputs {
  /** The live 2–3-year fixed rate, %; null uses the fallback (and the screens say so). */
  ratePct: number | null;
  country: TaxCountry;
  /** Batch 17's buying costs (project_costs.buyingCosts). */
  buyingCosts: number;
  /** A flat's service charge and ground rent, £ a year; null for a house. */
  flat: FlatCharges | null;
  /** The certificate's rating, or null when not checked. */
  epc: EpcRating | null;
  finance?: BtlFinance;
  costs?: BtlCosts;
  epcSettings?: BtlEpcSettings;
}

export interface CostLines {
  emptyMonths: number;
  agent: number;
  repairs: number;
  insurance: number;
  safety: number;
  serviceCharge: number;
  groundRent: number;
  total: number;
}

export interface RentTest {
  pass: boolean;
  /** The rent tested (the middle). */
  rent: number;
  stressRatePct: number;
  /** The least rent that passes at this loan. */
  requiredRent: number;
  /** The most a lender would lend on this rent. */
  maxLoan: number;
  /** The deposit that would pass, % of the price (whole, rounded up); null when it already passes. */
  depositPctToPass: number | null;
  depositToPass: number | null;
}

export interface BtlDeal {
  price: number;
  rent: Range3;
  ratePct: number;
  /** The live rate was missing and the fallback was used. */
  rateFallback: boolean;
  loan: number;
  mortgageMonthly: number;
  /** Running costs a month (before the mortgage). */
  monthlyCosts: Range3;
  /** The middle's costs, line by line. */
  costLines: CostLines;
  cashflowMonthly: Range3;
  grossYieldPct: Range3;
  netYieldPct: Range3;
  cashIn: Range3;
  deposit: number;
  tax: number;
  taxName: TaxName;
  buyingCosts: number;
  epcAllowance: number;
  roiPct: Range3;
  rentTest: RentTest;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The stress rate a lender tests at: the higher of the live rate plus the margin, or the floor. */
export function stressRatePct(liveRatePct: number, f: BtlFinance = DEFAULT_BTL_FINANCE): number {
  return Math.max(liveRatePct + f.stressAddPct, f.stressFloorPct);
}

/**
 * The lender rent test: rent ≥ ICR × the monthly interest on the loan at the
 * stress rate. Also the deposit that would pass on this rent.
 */
export function lenderRentTest(rent: number, loan: number, liveRatePct: number, f: BtlFinance = DEFAULT_BTL_FINANCE): RentTest | null {
  if (!Number.isFinite(rent) || !Number.isFinite(loan) || !Number.isFinite(liveRatePct) || loan <= 0 || rent < 0) return null;
  const stress = stressRatePct(liveRatePct, f);
  const factor = (f.icrPct / 100) * (stress / 100) / 12;
  const requiredRent = loan * factor;
  const maxLoan = factor > 0 ? rent / factor : 0;
  const pass = rent >= requiredRent;
  const price = loan / (f.ltvPct / 100);
  const depositPct = pass ? null : Math.min(100, Math.ceil((1 - maxLoan / price) * 100));
  return {
    pass,
    rent: Math.round(rent),
    stressRatePct: Math.round(stress * 100) / 100,
    requiredRent: Math.round(requiredRent),
    maxLoan: Math.round(maxLoan),
    depositPctToPass: depositPct,
    depositToPass: depositPct === null ? null : Math.round((price * depositPct) / 100),
  };
}

/** Running costs a month at this rent, with this month's service charge and ground rent. */
export function monthlyCostsAt(rent: number, serviceChargeYear: number, groundRentYear: number, c: BtlCosts = DEFAULT_BTL_COSTS): CostLines {
  const collected = (rent * (12 - c.emptyMonths)) / 12;
  const lines = {
    emptyMonths: (rent * c.emptyMonths) / 12,
    agent: (collected * c.agentPct) / 100,
    repairs: (collected * c.repairsPct) / 100,
    insurance: c.insurancePcm,
    safety: c.safetyPerYear / 12,
    serviceCharge: serviceChargeYear / 12,
    groundRent: groundRentYear / 12,
  };
  const total = lines.emptyMonths + lines.agent + lines.repairs + lines.insurance + lines.safety + lines.serviceCharge + lines.groundRent;
  return { ...lines, total };
}

/** The EPC upgrade allowance on the high end of cash in. */
export function epcAllowanceFor(rating: EpcRating | null, s: BtlEpcSettings = DEFAULT_BTL_EPC): number {
  if (rating === null) return s.unknownAllowance;
  if (rating === 'D') return s.allowanceD;
  if (rating === 'E' || rating === 'F' || rating === 'G') return s.allowanceEtoG;
  return 0;
}

export function isEpcRating(v: unknown): v is EpcRating {
  return typeof v === 'string' && /^[A-G]$/.test(v);
}

function roundRange(r: Range3, f: (n: number) => number = Math.round): Range3 {
  return { low: f(r.low), mid: f(r.mid), high: f(r.high) };
}

/** Every BTL figure as a range, or null when the price or rent is unusable. */
export function btlDeal(price: number, rentRange: BtlRentInput | null, inputs: BtlInputs): BtlDeal | null {
  if (!rentRange || !Number.isFinite(price) || price <= 0) return null;
  if (![rentRange.low, rentRange.mid, rentRange.high].every((n) => Number.isFinite(n) && n > 0)) return null;
  const f = inputs.finance ?? DEFAULT_BTL_FINANCE;
  const c = inputs.costs ?? DEFAULT_BTL_COSTS;
  const rateFallback = inputs.ratePct === null || !Number.isFinite(inputs.ratePct) || inputs.ratePct <= 0;
  const ratePct = rateFallback ? f.fallbackRatePct : (inputs.ratePct as number);
  const loan = price * (f.ltvPct / 100);
  const mortgageMonthly = mortgagePayment(loan, { ...DEFAULT_FINANCE, mortgageRatePct: ratePct });

  const sc = inputs.flat?.serviceCharge ?? { low: 0, mid: 0, high: 0 };
  const gr = inputs.flat?.groundRent ?? { low: 0, mid: 0, high: 0 };
  const rent = { low: rentRange.low, mid: rentRange.mid, high: rentRange.high };
  // The low end: low rent, high charges; the high end: high rent, low charges.
  const costLow = monthlyCostsAt(rent.low, sc.high, gr.high, c);
  const costMid = monthlyCostsAt(rent.mid, sc.mid, gr.mid, c);
  const costHigh = monthlyCostsAt(rent.high, sc.low, gr.low, c);
  const net = { low: rent.low - costLow.total, mid: rent.mid - costMid.total, high: rent.high - costHigh.total };
  const cashflow = { low: net.low - mortgageMonthly, mid: net.mid - mortgageMonthly, high: net.high - mortgageMonthly };

  const deposit = price - loan;
  const taxFigure = stampDutyLocal(price, inputs.country);
  const epcAllowance = epcAllowanceFor(inputs.epc, inputs.epcSettings ?? DEFAULT_BTL_EPC);
  const cashMid = deposit + taxFigure.amount + Math.max(0, inputs.buyingCosts);
  const cashIn = { low: cashMid, mid: cashMid, high: cashMid + epcAllowance };

  // Each ROI end on its rounded cashflow and cash in, so the numbers on screen add up.
  const cf = roundRange(cashflow);
  const cash = roundRange(cashIn);
  const roi = { low: (cf.low * 12 * 100) / cash.high, mid: (cf.mid * 12 * 100) / cash.mid, high: (cf.high * 12 * 100) / cash.low };
  const yieldOf = (n: number) => (n * 12 * 100) / price;
  const rentTest = lenderRentTest(rent.mid, loan, ratePct, f);
  if (!rentTest) return null;

  return {
    price,
    rent: roundRange(rent),
    ratePct,
    rateFallback,
    loan: Math.round(loan),
    mortgageMonthly: Math.round(mortgageMonthly),
    monthlyCosts: roundRange({ low: costLow.total, mid: costMid.total, high: costHigh.total }),
    costLines: {
      emptyMonths: Math.round(costMid.emptyMonths),
      agent: Math.round(costMid.agent),
      repairs: Math.round(costMid.repairs),
      insurance: Math.round(costMid.insurance),
      safety: Math.round(costMid.safety),
      serviceCharge: Math.round(costMid.serviceCharge),
      groundRent: Math.round(costMid.groundRent),
      total: Math.round(costMid.total),
    },
    cashflowMonthly: cf,
    grossYieldPct: roundRange({ low: yieldOf(rent.low), mid: yieldOf(rent.mid), high: yieldOf(rent.high) }, round1),
    netYieldPct: roundRange({ low: yieldOf(net.low), mid: yieldOf(net.mid), high: yieldOf(net.high) }, round1),
    cashIn: cash,
    deposit: Math.round(deposit),
    tax: taxFigure.amount,
    taxName: taxFigure.name,
    buyingCosts: Math.round(Math.max(0, inputs.buyingCosts)),
    epcAllowance,
    roiPct: roundRange(roi, round1),
    rentTest,
  };
}

/** "How much cash can you put in?" (Part E): under the first top, … the last band has no top. */
export type CashBand = 'under_25k' | '25k_50k' | '50k_100k' | '100k_plus';

export const CASH_BANDS: readonly CashBand[] = ['under_25k', '25k_50k', '50k_100k', '100k_plus'];

export function isCashBand(v: unknown): v is CashBand {
  return typeof v === 'string' && (CASH_BANDS as readonly string[]).includes(v);
}

/** The band a cash-in figure falls in. */
export function cashBandFor(cashIn: number, tops: readonly number[] = DEFAULT_BTL_BANDS): CashBand | null {
  if (!Number.isFinite(cashIn) || cashIn < 0) return null;
  for (let i = 0; i < tops.length && i < CASH_BANDS.length - 1; i++) if (cashIn < tops[i]) return CASH_BANDS[i];
  return CASH_BANDS[Math.min(tops.length, CASH_BANDS.length - 1)];
}

/** The most a member in this band can put in (Infinity for the top band). */
export function bandTop(band: CashBand, tops: readonly number[] = DEFAULT_BTL_BANDS): number {
  const i = CASH_BANDS.indexOf(band);
  return i >= 0 && i < tops.length ? tops[i] : Number.POSITIVE_INFINITY;
}

/** A deal is in budget when its middle cash in is no more than the top of the member's band. */
export function inBudget(cashInMid: number, band: CashBand, tops: readonly number[] = DEFAULT_BTL_BANDS): boolean {
  return Number.isFinite(cashInMid) && cashInMid <= bandTop(band, tops);
}
