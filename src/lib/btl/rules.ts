/**
 * When a BTL deal passes for a member, and when it is a standout (Batch 28,
 * Part D, decided by Zac).
 *
 *   EVERY PRIORITY  low-end monthly cashflow £0 or more AND a pass on the
 *                   lender rent test. These are the hard rules: a deal that
 *                   fails either is never a BTL deal.
 *   INCOME          the middle ROI ≥ the benchmark's median ROI.
 *   GROWTH          the middle annual growth ≥ the benchmark's median.
 *   A BIT OF BOTH   both middles ≥ the benchmark's 40th percentile.
 *   NO BENCHMARK    fewer than the floor even nationally: the hard rules
 *                   alone decide, and the card says there was too little to
 *                   compare with (Q6).
 *
 *   STANDOUT        the LOW end on the member's priority ≥ 125% of the
 *                   benchmark median, plus the hard rules (and Batch 25's own
 *                   rules, applied by standout/rules.ts). Never when the
 *                   median is 0% or less. An income standout also needs a
 *                   low-end ROI of at least 6% (Q8): where the typical deal
 *                   earns about nothing, 125% of nothing is not a standout.
 *
 * Pure: no network, no database, no server-only.
 */

import { DEFAULT_BTL_STANDOUT, type BtlStandoutSettings } from './config.ts';
import type { Benchmark } from './benchmark.ts';
import type { Range3 } from './deal.ts';

export type BtlPriority = 'income' | 'growth' | 'both';

export const BTL_PRIORITIES: readonly BtlPriority[] = ['income', 'growth', 'both'];

export const BTL_PRIORITY_LABELS: Record<BtlPriority, string> = {
  income: 'Money each month',
  growth: 'Value going up',
  both: 'A bit of both',
};

export function isBtlPriority(v: unknown): v is BtlPriority {
  return typeof v === 'string' && (BTL_PRIORITIES as readonly string[]).includes(v);
}

/** The figures the rules read. */
export interface BtlJudged {
  roiPct: Range3;
  /** Annual growth, %; null when the district has none. */
  growthPct: Range3 | null;
  cashflowLow: number;
  rentTestPass: boolean;
}

export type BtlFailure = 'rent_test' | 'negative_cashflow' | 'below_benchmark' | 'no_growth_figure';

export interface BtlVerdict {
  pass: boolean;
  /** The hard rules: cashflow and the lender test. */
  floorsOk: boolean;
  /** Compared with a benchmark (false: too few deals, the hard rules decided). */
  compared: boolean;
  failures: BtlFailure[];
}

/** The hard rules, the same for every member. */
export function floorsPass(d: Pick<BtlJudged, 'cashflowLow' | 'rentTestPass'>): boolean {
  return d.rentTestPass && Number.isFinite(d.cashflowLow) && d.cashflowLow >= 0;
}

export function passesFor(priority: BtlPriority, d: BtlJudged, bm: Benchmark | null): BtlVerdict {
  const failures: BtlFailure[] = [];
  if (!d.rentTestPass) failures.push('rent_test');
  if (!(d.cashflowLow >= 0)) failures.push('negative_cashflow');
  const floorsOk = failures.length === 0;
  if (!bm || bm.none) return { pass: floorsOk, floorsOk, compared: false, failures };
  const growth = d.growthPct;
  let beats: boolean;
  if (priority === 'income') beats = d.roiPct.mid >= bm.roiMedianPct;
  else if (priority === 'growth') beats = growth !== null && bm.growthMedianPct !== null && growth.mid >= bm.growthMedianPct;
  else beats = d.roiPct.mid >= bm.roiP40Pct && growth !== null && bm.growthP40Pct !== null && growth.mid >= bm.growthP40Pct;
  if (!beats) failures.push(priority !== 'income' && growth === null ? 'no_growth_figure' : 'below_benchmark');
  return { pass: floorsOk && beats, floorsOk, compared: true, failures };
}

/** The BTL part of a standout (Batch 25 adds its own rules on top). */
export function btlStandout(priority: BtlPriority, d: BtlJudged, bm: Benchmark | null, s: BtlStandoutSettings = DEFAULT_BTL_STANDOUT): boolean {
  if (!floorsPass(d) || !bm || bm.none) return false;
  const over = s.lowOverMedianPct / 100;
  const income = () => bm.roiMedianPct > 0 && d.roiPct.low >= bm.roiMedianPct * over && d.roiPct.low >= s.minLowRoiPct;
  const growth = () => d.growthPct !== null && bm.growthMedianPct !== null && bm.growthMedianPct > 0 && d.growthPct.low >= bm.growthMedianPct * over;
  if (priority === 'income') return income();
  if (priority === 'growth') return growth();
  return income() && growth();
}
