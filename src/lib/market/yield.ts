/**
 * Yield-on-cost for a Market Explorer area.
 *
 * Yield-on-cost = annual gross revenue ÷ property value, expressed as a %.
 * The property value proxy is the midpoint of avg_property_value_low/high from
 * the market-stats API (an explicit v1 simplification — no live PropertyData
 * call per area).
 *
 * An area has several bedroom groups. We aggregate across only the groups that
 * have BOTH a property value and gross revenue, sample-count-weighted, then
 * divide once — so the numerator and denominator describe the same set of
 * properties.
 *
 * NULL HANDLING (decided, per Step 3 spec): if no bedroom group has a non-null
 * property value, yield-on-cost is `null` and the card OMITS the stat entirely
 * — it never shows "£NaN", "0%", or "∞". Callers must treat `null` as "not
 * enough data to compute a yield" and hide the stat.
 */

import type { MarketArea, MarketBedroomAgg } from './types';

export interface YieldOnCost {
  /** Gross annual revenue as a % of property value. */
  grossYieldPct: number;
  /** Net annual revenue as a % of property value, or null if net unavailable. */
  netYieldPct: number | null;
  /** Property-value midpoint used as the denominator (GBP). */
  propertyValueMid: number;
  /** Sample-weighted gross revenue used as the numerator (GBP). */
  grossRevenue: number;
  /** Total samples across the bedroom groups that backed this figure. */
  sampleCount: number;
}

function midpoint(g: MarketBedroomAgg): number | null {
  if (g.avg_property_value_low === null || g.avg_property_value_high === null) return null;
  return (g.avg_property_value_low + g.avg_property_value_high) / 2;
}

/** Sample-weighted mean of (value(g), g.sample_count) over groups where value is non-null. */
function weighted(
  groups: MarketBedroomAgg[],
  value: (g: MarketBedroomAgg) => number | null,
): { mean: number; samples: number } | null {
  let weightedSum = 0;
  let samples = 0;
  for (const g of groups) {
    const v = value(g);
    if (v === null || g.sample_count <= 0) continue;
    weightedSum += v * g.sample_count;
    samples += g.sample_count;
  }
  if (samples === 0) return null;
  return { mean: weightedSum / samples, samples };
}

export function computeYieldOnCost(area: MarketArea): YieldOnCost | null {
  // Only groups with BOTH a property value and gross revenue can back a yield.
  const backed = area.by_bedrooms.filter(
    (g) => midpoint(g) !== null && g.avg_gross_revenue !== null,
  );
  if (backed.length === 0) return null;

  const value = weighted(backed, midpoint);
  const gross = weighted(backed, (g) => g.avg_gross_revenue);
  if (!value || !gross || value.mean <= 0) return null;

  const grossYieldPct = round1((gross.mean / value.mean) * 100);

  // Net yield over the same value-backed groups that also have a net figure.
  const net = weighted(backed, (g) => g.avg_net_revenue);
  const netYieldPct = net ? round1((net.mean / value.mean) * 100) : null;

  return {
    grossYieldPct,
    netYieldPct,
    propertyValueMid: Math.round(value.mean),
    grossRevenue: Math.round(gross.mean),
    sampleCount: value.samples,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
