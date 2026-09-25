/**
 * The one call airbtics.ts makes to turn a report's comparable histories into
 * the optional report fields. Kept here so the glue is tested too.
 */

import { annualEarningsRange, monthlyEarningsRange, type EarningsRange } from './earnings.ts';
import { localTrend, type LocalTrend } from './local-trend.ts';
import { SEASONAL_WINDOW_MONTHS, windowEndingAt, type CompHistory } from './months.ts';
import { stayProfile, type StayProfile } from './stays.ts';

export interface HistoryExtras {
  earningsRange: EarningsRange | null;
  localTrend: LocalTrend | null;
  stayProfile: StayProfile | null;
}

export function compHistoryExtras(i: {
  /** Latest complete month (absolute index), from `latestCompleteMonth`. */
  anchor: number | null;
  /** The guest-filtered pool — wider sample for trend and stays. */
  similar: ReadonlyArray<CompHistory>;
  /** The displayed comparables, with scale = displayed ÷ raw annual revenue. */
  displayed: ReadonlyArray<CompHistory & { scale: number }>;
  /** `comparables[].annualRevenue`, same order as `displayed`. */
  displayedRevenues: readonly number[];
}): HistoryExtras {
  const annual = annualEarningsRange(i.displayedRevenues);
  if (i.anchor === null) {
    return { earningsRange: annual ? { basis: 'comparables', annual, monthly: null } : null, localTrend: null, stayProfile: null };
  }
  const monthly = monthlyEarningsRange(
    i.displayed.map((c) => ({ revenue: c.revenue_ltm_monthly, scale: c.scale })),
    { end: i.anchor, months: 12 },
  );
  const earningsRange: EarningsRange | null = annual || monthly ? { basis: 'comparables', annual, monthly } : null;
  return {
    earningsRange,
    localTrend: localTrend(i.similar, i.anchor),
    stayProfile: stayProfile(i.similar, windowEndingAt(i.anchor, SEASONAL_WINDOW_MONTHS)),
  };
}
