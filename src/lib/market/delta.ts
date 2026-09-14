/**
 * The small "+8% vs prior 3 mo" tag next to a KPI. Built from a TrendResult,
 * which compares the last full months against the ones before (see trend.ts)
 * — the explorer has no year-on-year history, so the tag always says which
 * window it is comparing and never "past year".
 */

import type { TrendResult } from './trend.ts';

export type DeltaTone = 'up' | 'down' | 'neutral';

export interface DeltaTag {
  text: string;
  /** Direction only: whether "up" is good is for the caller to decide. */
  tone: DeltaTone;
}

export const BUILDING_HISTORY = 'Building history';

export function deltaTag(t: TrendResult | null | undefined): DeltaTag {
  if (!t || t.direction === 'insufficient' || t.deltaPct === null) return { text: BUILDING_HISTORY, tone: 'neutral' };
  const months = t.priorMonths > 0 ? t.priorMonths : 3;
  if (t.direction === 'flat') return { text: `Steady vs prior ${months} mo`, tone: 'neutral' };
  const pct = Math.round(Math.abs(t.deltaPct) * 100);
  const sign = t.direction === 'up' ? '+' : '−';
  return { text: `${sign}${pct}% vs prior ${months} mo`, tone: t.direction };
}
