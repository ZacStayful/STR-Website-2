import { estimateAction, reportAction } from '../credit/estimate.ts';
import type { UnitCostTable } from '../credit/costs.ts';
import type { SpendRates } from '../credit/pricing.ts';

/**
 * What a funnel will cost before a customer sets it live.
 *
 * A customer publishing a funnel today has no idea what it will spend until
 * the leads start arriving and the balance starts moving, which is the worst
 * possible moment to find out.
 *
 * No new pricing maths. This wraps the SAME `estimateAction(table,
 * reportAction(enhanced), { markupOverride })` the funnel analyse route
 * prices with, so the quote and the charge cannot disagree — the failure
 * mode that would turn an estimator into a liability.
 *
 * Pure, so it is tested: a half-applied markup shows up here and nowhere
 * else, and "we quoted £212 and charged £530" is not a mistake worth making
 * once.
 */

export interface FunnelCost {
  /**
   * Base pence for one lead before the grant's spend rate. Precise, so it
   * carries fractions of a penny — display `perLeadPence` instead.
   */
  perLeadBasePence: number;
  /** Whole pence a balance is actually reduced by, per lead. Show this one. */
  perLeadPence: number;
  /** The worst case reserved during a run — what solvency is checked against. */
  perLeadWorstCasePence: number;
  monthlyPence: number;
  /** Rounded up to the nearest top-up preset that covers the month. */
  recommendedTopupPence: number;
  /** How many leads the recommended top-up buys. */
  leadsPerTopup: number;
}

export interface FunnelCostInput {
  leadsPerMonth: number;
  enhanced: boolean;
  table: UnitCostTable;
  /** The funnel markup from billing settings (2 by default). */
  markup: number;
  /**
   * Spend rates. Top-up credit is spent at 1.5x, which is what a
   * pay-per-use customer will actually be charged — quoting the base rate
   * would under-state it by a third.
   */
  spendRates: SpendRates;
  topupPresetsPence: number[];
}

/** Whole leads only, and never a negative month. */
function leadCount(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

export function funnelCost(input: FunnelCostInput): FunnelCost {
  const estimate = estimateAction(input.table, reportAction(input.enhanced), {
    markupOverride: input.markup,
  });

  // The rate a top-up is spent at, because that is how a pay-per-use funnel
  // customer pays. Falls back to 1 rather than 0 — under-quoting is the
  // direction that costs the customer a surprise.
  const rate = Number.isFinite(input.spendRates.topup) && input.spendRates.topup > 0 ? input.spendRates.topup : 1;

  const perLeadBasePence = estimate.typicalBasePence;
  const perLeadPence = Math.round(perLeadBasePence * rate);
  const perLeadWorstCasePence = Math.round(estimate.maxBasePence * rate);

  const leads = leadCount(input.leadsPerMonth);
  const monthlyPence = perLeadPence * leads;

  return {
    perLeadBasePence,
    perLeadPence,
    perLeadWorstCasePence,
    monthlyPence,
    recommendedTopupPence: recommendTopup(monthlyPence, input.topupPresetsPence),
    leadsPerTopup:
      perLeadPence > 0
        ? Math.floor(recommendTopup(monthlyPence, input.topupPresetsPence) / perLeadPence)
        : 0,
  };
}

/**
 * The smallest offered top-up that covers the month, or the largest one when
 * nothing does — a customer spending more than the biggest preset should be
 * pointed at the biggest preset, not at nothing.
 */
export function recommendTopup(monthlyPence: number, presets: number[]): number {
  const sorted = [...presets].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  if (monthlyPence <= 0) return sorted[0];
  return sorted.find((p) => p >= monthlyPence) ?? sorted[sorted.length - 1];
}
