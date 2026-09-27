/**
 * The deal maths at the end of a full analysis: the member's finance and
 * mortgage rate, the bills from the council tax band, the deal itself
 * (purchase or rent-to-rent), the month-by-month cash flow and the value in
 * five years.
 *
 * Lifted out of `runAnalysis` (src/lib/analysis/run.ts) unchanged, so that a
 * saved analysis of a deal can be priced at ANOTHER member's finance without
 * a single provider call (src/lib/analysis/reuse.ts): the report run and the
 * reuse go through the same function and cannot drift apart.
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { purchaseDeal, rentToRentDeal, monthlyCashflow, type CashflowMonth } from '../listing/deal.ts';
import { billsFromCouncilTax, type CouncilTaxFigure } from '../listing/bills.ts';
import { futureValueRange } from '../listing/growth.ts';
import { DEFAULT_FINANCE_GOALS, type FinanceGoals } from '../market/goals.ts';
import type { LiveMortgageRate, MortgageRateInfo } from '../listing/mortgage-rate.ts';
import type { StampDutyFigure, TaxCountry } from '../listing/stamp-duty.ts';
import type { DealResult, FutureValueRange, OutcodeGrowth, ShortLetData } from '../types.ts';

export interface DealFiguresInput {
  shortLet: Pick<ShortLetData, 'annualRevenue' | 'averageDailyRate' | 'monthlyRevenue'>;
  bedrooms: number;
  taxCountry: TaxCountry;
  /** The listing's asking price (a sale). */
  askingPrice: number | null;
  /** The listing's rent, per calendar month (a rental: rent-to-rent). */
  rentPcm: number | null;
  /** PropertyData's estimated value, the deal's price when there is no asking price or rent. */
  estimatedValue: number | null;
  councilTax: CouncilTaxFigure | null;
  /** PropertyData's stamp duty for the purchase price; the local bands are used without it. */
  stampDuty?: StampDutyFigure;
  growth: OutcodeGrowth | null;
  /** The member's saved finance. Absent: the national average rate, else the defaults. */
  finance?: FinanceGoals;
  liveRate: LiveMortgageRate | null;
}

export interface DealFigures {
  deal: DealResult | null;
  cashflow: CashflowMonth[] | null;
  futureValue: FutureValueRange | null;
}

export function dealFigures(i: DealFiguresInput): DealFigures {
  // A member's saved goal profile wins; otherwise the higher of the
  // national 2- and 3-year fixed averages, and only then the old 5.5%.
  const finance: FinanceGoals = i.finance ?? { ...DEFAULT_FINANCE_GOALS, ...(i.liveRate ? { mortgageRatePct: i.liveRate.ratePct } : {}) };
  const mortgageRate: MortgageRateInfo = { source: i.finance ? 'profile' : i.liveRate ? 'live' : 'default', live: i.liveRate };

  // Council tax from the property's own band replaces the council-tax
  // share of the old flat £250 bills line.
  const bills = { ...billsFromCouncilTax(i.councilTax), councilTax: i.councilTax };

  // Where the value might go: the outcode's past five years projected
  // forward as a range. Informational only; nothing else reads it.
  const valueBase = i.askingPrice ?? i.estimatedValue ?? null;
  const futureValue = i.growth && valueBase ? futureValueRange(valueBase, i.askingPrice ? 'asking-price' : 'estimated-value', i.growth.growth5y, i.growth.outcode, i.growth.asOf) : null;

  const dealBase = { grossRevenue: i.shortLet.annualRevenue, adr: i.shortLet.averageDailyRate, bedrooms: i.bedrooms, finance, country: i.taxCountry, stampDuty: i.stampDuty, mortgageRate, bills };
  let deal: DealResult | null = null;
  if (i.rentPcm) deal = { ...rentToRentDeal(i.rentPcm, dealBase), basis: 'advertised-rent' };
  else if (i.askingPrice) deal = { ...purchaseDeal(i.askingPrice, dealBase), basis: 'asking-price' };
  else if (i.estimatedValue) deal = { ...purchaseDeal(i.estimatedValue, dealBase), basis: 'estimated-value' };
  const fixedPcm = deal?.kind === 'rent-to-rent' ? deal.advertisedRentPcm : deal?.kind === 'purchase' ? deal.mortgageMonthly : 0;
  const cashflow = i.shortLet.annualRevenue > 0 ? monthlyCashflow(i.shortLet.monthlyRevenue, fixedPcm, { billsPcm: bills.billsPcm }) : null;
  return { deal, cashflow, futureValue };
}
