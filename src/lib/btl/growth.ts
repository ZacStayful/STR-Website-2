/**
 * Value growth for a BTL deal (Batch 28, Part B): history only, never a
 * forecast. The 5-year value range is futureValueRange() (listing/growth.ts),
 * whose top end repeats the district's last five years and whose low end
 * takes half that rate (capped at 3% a year, floored at 0). Alongside it the
 * annual rate as low / middle / high (the middle is what the pass rules
 * compare), and the district's 1-year figure so a market that has turned
 * is visible.
 *
 * Pure: no network, no database, no server-only.
 */

import { futureValueRange, HAIRCUT_CAP_PCT } from '../listing/growth.ts';
import type { FutureValueRange } from '../types.ts';
import type { Range3 } from './deal.ts';

export interface BtlGrowth {
  value5y: FutureValueRange;
  /** Annual growth, % a year: low and high are the range's two ends, the middle halfway. */
  annualPct: Range3;
  /** The district's last 12 months, %. */
  growth1yPct: number | null;
  /** The last year fell while the five-year history rose. */
  turning: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function growthRange(price: number, growth5yPct: number | null | undefined, growth1yPct: number | null | undefined, outcode: string, asOf: string | null): BtlGrowth | null {
  const fv = futureValueRange(price, 'asking-price', growth5yPct, outcode, asOf);
  if (!fv) return null;
  const years = fv.horizonYears;
  const annual = (Math.pow(1 + (growth5yPct as number) / 100, 1 / years) - 1) * 100;
  const haircut = Math.min(Math.max(annual / 2, 0), HAIRCUT_CAP_PCT);
  const low = Math.min(annual, haircut);
  const high = Math.max(annual, haircut);
  const one = growth1yPct !== null && growth1yPct !== undefined && Number.isFinite(growth1yPct) ? growth1yPct : null;
  return {
    value5y: fv,
    annualPct: { low: round2(low), mid: round2((low + high) / 2), high: round2(high) },
    growth1yPct: one,
    turning: one !== null && one < 0 && annual > 0,
  };
}
