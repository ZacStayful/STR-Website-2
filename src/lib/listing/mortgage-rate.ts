import type { MortgageRates } from '../apis/propertydata-parse.ts';

/**
 * Which national average the deal maths borrows when a member has not set
 * their own rate: the higher of the 2-year and 3-year fixed averages (both
 * quoted at 75% loan-to-value, matching the 25% deposit default), so the
 * default errs on the cautious side.
 */

export type MortgageRateSource = 'profile' | 'live' | 'default';

export interface LiveMortgageRate {
  ratePct: number;
  product: '2-year fixed' | '3-year fixed';
  /** "Jun 2023": the month PropertyData's average is for. */
  date: string | null;
}

/** What the deal used and what the market average was, for the panel and the PDF. */
export interface MortgageRateInfo {
  source: MortgageRateSource;
  /** The market average, whenever one was available (even if the profile rate was used). */
  live: LiveMortgageRate | null;
}

export function liveMortgageRate(rates: MortgageRates | null | undefined): LiveMortgageRate | null {
  if (!rates) return null;
  const candidates: LiveMortgageRate[] = [];
  if (rates.fixed2y) candidates.push({ ratePct: rates.fixed2y.ratePct, product: '2-year fixed', date: rates.fixed2y.date });
  if (rates.fixed3y) candidates.push({ ratePct: rates.fixed3y.ratePct, product: '3-year fixed', date: rates.fixed3y.date });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.ratePct - a.ratePct);
  return candidates[0];
}

/** "avg 3-year fixed 5.29% (Jun 2023)" */
export function liveMortgageRateLabel(live: LiveMortgageRate): string {
  return `avg ${live.product} ${live.ratePct}%${live.date ? ` (${live.date})` : ''}`;
}
