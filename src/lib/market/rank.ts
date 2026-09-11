/** Sorting for the explorer list. Null values always sort last. */

import type { AreaCardData } from './explorer.ts';
import type { PersonalScore } from './personalise.ts';
import type { AreaTrend } from './trend.ts';

export type SortKey = 'stayful' | 'personal' | 'revenue' | 'yield' | 'occupancy' | 'competition' | 'directBooking' | 'distance' | 'trend';

export const SORT_LABELS: Record<SortKey, string> = {
  stayful: 'Stayful score',
  personal: 'Your fit',
  revenue: 'Avg revenue',
  yield: 'Yield-on-cost',
  occupancy: 'Occupancy',
  competition: 'Least competitive',
  directBooking: 'Direct-booking potential',
  distance: 'Closest to home',
  trend: 'Rising enquiries',
};

export interface ExplorerRow {
  card: AreaCardData;
  personal: PersonalScore | null;
  saved: boolean;
  trend?: AreaTrend | null;
}

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && Object.hasOwn(SORT_LABELS, v);
}

/** The value a row sorts by for a key (higher first), or null. */
export function sortValue(row: ExplorerRow, key: SortKey): number | null {
  const c = row.card;
  switch (key) {
    case 'stayful': return c.score?.score ?? null;
    case 'personal': return row.personal?.score ?? null;
    case 'revenue': return c.headline.grossRevenue;
    case 'yield': return c.yieldOnCost?.grossYieldPct ?? null;
    case 'occupancy': return c.headline.occupancy;
    case 'competition': return c.competition ? 100 - c.competition.percentile : null;
    case 'directBooking': return c.directBooking?.score ?? null;
    case 'distance': return row.personal?.fit.distanceMiles === null || row.personal?.fit.distanceMiles === undefined ? null : -row.personal.fit.distanceMiles;
    case 'trend': return row.trend && row.trend.enquiries.direction !== 'insufficient' ? row.trend.enquiries.deltaPct : null;
  }
}

export function sortRows(rows: ExplorerRow[], key: SortKey, savedFirst = false): ExplorerRow[] {
  return [...rows].sort((a, b) => {
    if (savedFirst && a.saved !== b.saved) return a.saved ? -1 : 1;
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (vb !== va) return vb - va;
    return tieBreak(a, b);
  });
}

function tieBreak(a: ExplorerRow, b: ExplorerRow): number {
  return (
    b.card.confidence.rank - a.card.confidence.rank ||
    (b.card.score?.score ?? -1) - (a.card.score?.score ?? -1) ||
    a.card.name.localeCompare(b.card.name)
  );
}
