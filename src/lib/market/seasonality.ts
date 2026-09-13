/**
 * Seasonality: how evenly an area's revenue spreads across the year.
 *
 * From the mean revenue per calendar month over the reports that carry a
 * monthly breakdown, the coefficient of variation (standard deviation ÷
 * mean) says how bumpy the year is. The score maps it to 0–100 with 100 a
 * perfectly even year; cv 0.6 or worse scores 0. Labels use the same cut
 * points as the address-level risk model (analysis.ts): cv ≤ 0.15 steady,
 * ≤ 0.35 seasonal, above that highly seasonal. Null until three reports
 * carry a breakdown, so one property's calendar never stands in for a market.
 */

import type { SeasonalityRaw } from './types.ts';

export const MIN_SEASONALITY_REPORTS = 3;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CV_FLOOR = 0.6; // cv at which the score reaches 0

export type SeasonalityLabel = 'Steady' | 'Seasonal' | 'Highly seasonal';

export interface Seasonality {
  score: number; // 0–100, 100 = perfectly even
  label: SeasonalityLabel;
  cv: number;
  peakMonth: number; // 0–11
  lowMonth: number; // 0–11
  /** Share of annual revenue per calendar month (sums to 1). */
  profile: number[];
  peakShare: number;
  lowShare: number;
  sampleCount: number;
  explanation: string;
}

export function coefficientOfVariation(values: number[]): number | null {
  if (values.length === 0) return null;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  if (m <= 0) return null;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance) / m;
}

export function seasonalityScore(cv: number): number {
  return Math.round(100 * Math.max(0, Math.min(1, 1 - cv / CV_FLOOR)));
}

export function seasonalityLabel(score: number): SeasonalityLabel {
  if (score >= 75) return 'Steady';
  if (score >= 42) return 'Seasonal';
  return 'Highly seasonal';
}

export function areaSeasonality(raw: SeasonalityRaw | null | undefined): Seasonality | null {
  if (!raw || raw.sample_count < MIN_SEASONALITY_REPORTS || raw.monthly.length !== 12) return null;
  const total = raw.monthly.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  const cv = coefficientOfVariation(raw.monthly);
  if (cv === null) return null;
  const profile = raw.monthly.map((v) => v / total);
  let peakMonth = 0;
  let lowMonth = 0;
  profile.forEach((v, i) => {
    if (v > profile[peakMonth]) peakMonth = i;
    if (v < profile[lowMonth]) lowMonth = i;
  });
  const score = seasonalityScore(cv);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return {
    score,
    label: seasonalityLabel(score),
    cv: Math.round(cv * 1000) / 1000,
    peakMonth,
    lowMonth,
    profile,
    peakShare: profile[peakMonth],
    lowShare: profile[lowMonth],
    sampleCount: raw.sample_count,
    explanation: `Peaks in ${MONTH_SHORT[peakMonth]} (${pct(profile[peakMonth])} of the year), quietest in ${MONTH_SHORT[lowMonth]} (${pct(profile[lowMonth])}).`,
  };
}
