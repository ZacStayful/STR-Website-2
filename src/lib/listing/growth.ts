import type { FutureValueRange } from '../types.ts';

/**
 * A value range five years out from the outcode's historic growth. The top
 * end repeats the last five years; the low end takes half that rate,
 * capped at 3% a year and floored at nothing. It is an assumption drawn
 * from history and the copy says so; it never feeds yields or cashflow.
 */

export const GROWTH_HORIZON_YEARS = 5;
export const HAIRCUT_CAP_PCT = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function futureValueRange(
  baseValue: number,
  basis: FutureValueRange['basis'],
  historicGrowth5yPct: number | null | undefined,
  outcode: string,
  asOf: string | null,
): FutureValueRange | null {
  if (!Number.isFinite(baseValue) || baseValue <= 0) return null;
  if (historicGrowth5yPct === null || historicGrowth5yPct === undefined || !Number.isFinite(historicGrowth5yPct) || historicGrowth5yPct <= -100) return null;
  const years = GROWTH_HORIZON_YEARS;
  const annual = Math.pow(1 + historicGrowth5yPct / 100, 1 / years) - 1;
  const haircut = Math.min(Math.max(annual / 2, 0), HAIRCUT_CAP_PCT / 100);
  const a = baseValue * Math.pow(1 + annual, years);
  const b = baseValue * Math.pow(1 + haircut, years);
  return {
    baseValue: Math.round(baseValue),
    basis,
    horizonYears: years,
    historicGrowthPct: round1(historicGrowth5yPct),
    annualisedPct: round1(annual * 100),
    haircutAnnualPct: round1(haircut * 100),
    high: Math.round(Math.max(a, b)),
    low: Math.round(Math.min(a, b)),
    outcode,
    asOf,
  };
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/** The one-line explanation printed under the deal figures. */
export function futureValueSentence(fv: FutureValueRange): string {
  const basis = fv.basis === 'asking-price' ? 'the asking price' : 'the estimated value';
  return `Value in ${fv.horizonYears} years: ${gbp(fv.low)} to ${gbp(fv.high)} from ${basis} of ${gbp(fv.baseValue)}, repeating ${fv.outcode}'s 5-year growth of ${fv.historicGrowthPct}% (${fv.annualisedPct}% a year) at the top end and ${fv.haircutAnnualPct}% a year at the low end. An assumption from historic growth, not a forecast.`;
}
