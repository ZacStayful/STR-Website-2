/**
 * Area-level long-let vs short-let verdict.
 *
 * This does NOT re-implement the decision math. It reuses
 * `calculateFinancials` from `src/lib/analysis.ts` — the same single source of
 * truth the address-level analyser uses — and simply feeds it an AREA-AVERAGE
 * long-let figure (a PropertyData area rental estimate) instead of one specific
 * address's rent. The area short-let side is built from the market-stats
 * aggregates.
 *
 * Graceful degradation: if there's no usable long-let comparator for the area
 * (`longLetMonthlyRent` null/≤0), the verdict is `null` and the card shows a
 * "verdict unavailable" state rather than a broken or misleading figure — see
 * Step 6 edge cases.
 */

import { calculateFinancials } from '../analysis.ts';
import type { FinancialSummary, ShortLetData, LongLetData } from '../types.ts';
import type { MarketArea, MarketBedroomAgg } from './types.ts';

export type VerdictWinner = 'short-let' | 'long-let' | 'toss-up';

export interface AreaVerdict {
  /** The full financial comparison from analysis.ts (single source of truth). */
  financials: FinancialSummary;
  winner: VerdictWinner;
  /** |annual net difference| between the two strategies (GBP). */
  annualAdvantage: number;
  monthlyAdvantage: number;
  /** Occupancy the short-let must hit to match the long-let net, as a %. */
  breakEvenOccupancyPct: number;
  /** The area-average long-let monthly rent fed into the comparison. */
  longLetMonthlyRent: number;
}

/** Sample-weighted mean of a field across ALL bedroom groups with a non-null value. */
function weightedField(
  groups: MarketBedroomAgg[],
  value: (g: MarketBedroomAgg) => number | null,
): number | null {
  let sum = 0;
  let n = 0;
  for (const g of groups) {
    const v = value(g);
    if (v === null || g.sample_count <= 0) continue;
    sum += v * g.sample_count;
    n += g.sample_count;
  }
  return n === 0 ? null : sum / n;
}

/**
 * Build a ShortLetData for the area from its market-stats aggregates.
 * Only the fields `calculateFinancials` reads (annualRevenue, averageDailyRate)
 * need to be meaningful; the rest are filled with honest area-level values.
 */
export function buildAreaShortLet(area: MarketArea): ShortLetData | null {
  const annualRevenue = weightedField(area.by_bedrooms, (g) => g.avg_gross_revenue);
  const adr = weightedField(area.by_bedrooms, (g) => g.avg_adr);
  const occPct = weightedField(area.by_bedrooms, (g) => g.avg_occupancy);
  if (annualRevenue === null || adr === null) return null;

  const monthly = Math.round(annualRevenue / 12);
  return {
    annualRevenue: Math.round(annualRevenue),
    // No area-level seasonality data (out of scope for v1) — spread evenly.
    monthlyRevenue: Array.from({ length: 12 }, () => monthly) as ShortLetData['monthlyRevenue'],
    occupancyRate: occPct === null ? 0 : occPct / 100, // API gives 0–100; analysis expects 0–1
    averageDailyRate: Math.round(adr),
    activeListings: 0, // unknown at area level; only used by address-level risk scoring
    comparables: [],
  };
}

/**
 * Produce the area verdict. Pure: pass in the area-average long-let monthly
 * rent (fetched separately). Returns null when the area has no usable short-let
 * data or no usable long-let comparator.
 */
export function computeAreaVerdict(
  area: MarketArea,
  longLetMonthlyRent: number | null,
): AreaVerdict | null {
  if (longLetMonthlyRent === null || longLetMonthlyRent <= 0) return null;

  const shortLet = buildAreaShortLet(area);
  if (!shortLet) return null;

  const longLet: LongLetData = {
    monthlyRent: longLetMonthlyRent,
    estimateHigh: Math.round(longLetMonthlyRent * 1.15),
    estimateLow: Math.round(longLetMonthlyRent * 0.85),
    comparables: [],
  };

  // ── The single source of truth ──
  const financials = calculateFinancials(shortLet, longLet);

  // A margin under ~£1,000/yr net is a genuine toss-up given the estimate noise.
  const TOSS_UP_BAND = 1000;
  let winner: VerdictWinner;
  if (financials.annualDifference > TOSS_UP_BAND) winner = 'short-let';
  else if (financials.annualDifference < -TOSS_UP_BAND) winner = 'long-let';
  else winner = 'toss-up';

  return {
    financials,
    winner,
    annualAdvantage: Math.abs(financials.annualDifference),
    monthlyAdvantage: Math.abs(financials.monthlyDifference),
    breakEvenOccupancyPct: Math.round(financials.breakEvenOccupancy * 100),
    longLetMonthlyRent,
  };
}
