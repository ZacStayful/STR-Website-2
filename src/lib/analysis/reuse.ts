/**
 * Saved analyses: one member's Full analysis of a deal, reused by the next
 * member who buys a Full analysis of the same deal within the reuse window
 * (billing_settings.analysis_reuse_days), so the providers are paid once.
 *
 * What is kept (`toShared`) is only what the providers said about the
 * PROPERTY — short-let and long-let figures, comparables, demand, due
 * diligence, risk, the PMI second opinion — never anything about the member
 * who ran it: their deal (which carries their deposit, mortgage rate and
 * target), their cash flow, the report id, the notice about their own run.
 * Nothing here holds a name, finance inputs, notes or a stage, and the
 * store it lives in (deal_analyses) is service-role only.
 *
 * `rebuildForMember` prices the kept part at the BUYING member's own
 * finance with the same pure maths a report run uses (deal-figures.ts).
 *
 * Pure: no server-only, relative `.ts` imports only.
 */

import { dealFigures } from './deal-figures.ts';
import { countryForPostcode, type StampDutyFigure } from '../listing/stamp-duty.ts';
import type { AnalysisResult } from '../types.ts';
import type { FinanceGoals } from '../market/goals.ts';
import type { LiveMortgageRate } from '../listing/mortgage-rate.ts';
import type { AnalysisInput } from './input.ts';

/** The member-specific parts of a report, never kept for anyone else. */
export const MEMBER_FIELDS = ['deal', 'cashflow', 'futureValue', 'reportId', 'enhancedNotice'] as const;

export type SharedResult = Omit<AnalysisResult, (typeof MEMBER_FIELDS)[number]>;

export interface SharedAnalysis {
  result: SharedResult;
  /** PropertyData's stamp duty, priced at `stampDutyPrice`: reused only at that exact price. */
  stampDuty: StampDutyFigure | null;
  stampDutyPrice: number | null;
}

export function toShared(full: AnalysisResult): SharedAnalysis {
  const result: Record<string, unknown> = { ...full };
  for (const k of MEMBER_FIELDS) delete result[k];
  const deal = full.deal;
  const stampDuty: StampDutyFigure | null =
    deal && deal.kind === 'purchase' && deal.stampDutySource === 'propertydata' && deal.taxCountry && deal.stampDutyName
      ? { amount: deal.stampDuty, name: deal.stampDutyName, effectiveRatePct: deal.stampDutyEffectiveRatePct ?? 0, country: deal.taxCountry, source: 'propertydata' }
      : null;
  return { result: result as SharedResult, stampDuty, stampDutyPrice: stampDuty && deal?.kind === 'purchase' ? deal.askingPrice : null };
}

/** What a saved analysis keeps of its inputs: the questions the providers were asked, none of the member's. */
export type SharedInputs = Pick<AnalysisInput, 'property' | 'propertyType' | 'bathrooms' | 'parkingSpaces' | 'hasParking' | 'outdoorSpace' | 'askingPrice' | 'rentPcm' | 'sourceListing'>;

export function sharedInputs(i: AnalysisInput): SharedInputs {
  return {
    property: { ...i.property },
    propertyType: i.propertyType,
    bathrooms: i.bathrooms,
    parkingSpaces: i.parkingSpaces,
    hasParking: i.hasParking,
    outdoorSpace: i.outdoorSpace,
    askingPrice: i.askingPrice,
    rentPcm: i.rentPcm,
    sourceListing: i.sourceListing ? { ...i.sourceListing } : null,
  };
}

/**
 * A saved analysis as the buying member's own report: the property figures
 * as they were found, the deal, cash flow and five-year value at the
 * member's finance and today's price. `createdAt` stays the date the
 * providers answered, which the report shows as "Analysed on".
 */
export function rebuildForMember(
  shared: SharedAnalysis,
  opts: { finance?: FinanceGoals; liveRate: LiveMortgageRate | null; askingPrice: number | null; rentPcm: number | null; now: string; withSecondOpinion?: boolean },
): AnalysisResult {
  const r = shared.result;
  const purchasePrice = opts.rentPcm ? null : (opts.askingPrice ?? r.propertyValuation?.estimatedValue ?? null);
  const stampDuty = shared.stampDuty && purchasePrice !== null && shared.stampDutyPrice === purchasePrice ? shared.stampDuty : undefined;
  const { deal, cashflow, futureValue } = dealFigures({
    shortLet: r.shortLet,
    bedrooms: r.property.bedrooms,
    taxCountry: countryForPostcode(r.property.postcode),
    askingPrice: opts.askingPrice,
    rentPcm: opts.rentPcm,
    estimatedValue: r.propertyValuation?.estimatedValue ?? null,
    councilTax: r.councilTax ?? null,
    stampDuty,
    growth: r.growth ?? null,
    finance: opts.finance,
    liveRate: opts.liveRate,
  });
  // PMI's opinion is sold on its own: a buyer who did not pay for it does not
  // get it from the analysis someone else bought it with.
  const secondOpinion = opts.withSecondOpinion === false ? null : (r.secondOpinion ?? null);
  return { ...r, secondOpinion, deal, cashflow, futureValue, updatedAt: opts.now };
}

/** A full analysis delivered what it is bought for: short-let figures for the property. */
export function analysisComplete(result: Pick<AnalysisResult, 'shortLet'> | null | undefined): boolean {
  return Boolean(result && Number(result.shortLet?.annualRevenue) > 0);
}

/** Whether a saved analysis is young enough to reuse. */
export function reusable(analysedAtIso: string, reuseDays: number, now: Date = new Date()): boolean {
  const t = Date.parse(analysedAtIso);
  return Number.isFinite(t) && now.getTime() - t < reuseDays * 24 * 60 * 60 * 1000;
}
