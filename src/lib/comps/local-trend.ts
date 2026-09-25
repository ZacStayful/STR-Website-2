/**
 * Local trend: how similar listings nearby did over the latest 12 months
 * against the 12 before, from the comparables' own monthly history.
 *
 * Each of the latest 12 months is paired with the same calendar month a year
 * earlier and a pair only counts when both have revenue, so a gap drops that
 * month from both sides and never skews the seasonal mix. A listing also has
 * to have been earning before the comparison started, which keeps first-year
 * ramp-up from reading as growth. Only listings still operating are counted.
 *
 * Deliberately separate from `market/trend.ts`, which tracks enquiries.
 * Pure: loadable by `node --test`.
 */

import { monthKey, monthLabel, occupancyScale, series, type CompHistory } from './months.ts';

export const TREND_MIN_LISTINGS = 6;
export const TREND_MIN_PAIRED_MONTHS = 10;
export const TREND_LEAD_IN_MONTHS = 6;
export const TREND_MIN_LEAD_IN = 3;
export const TREND_FLAT_BAND = 0.03;

export interface LocalTrend {
  /** "YYYY-MM", the last month of the recent window. */
  to: string;
  /** Listings in the matched sample. */
  listings: number;
  /** Median per-listing revenue change; 0.08 = +8%. */
  revenueChange: number;
  /** Median per-listing change in mean nightly rate. */
  adrChange: number | null;
  /** Median per-listing change in mean occupancy, in fraction points (0.02 = +2 points). */
  occupancyPointsChange: number | null;
  direction: 'up' | 'flat' | 'down';
  /** Listings whose revenue rose. */
  rising: number;
  /** Pooled totals over the matched months, for later cross-report aggregation. */
  recentRevenue: number;
  priorRevenue: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pairedChange(dict: Map<number, number>, anchor: number, mean: boolean): { recent: number; prior: number } | null {
  let recent = 0;
  let prior = 0;
  let pairs = 0;
  for (let k = 0; k < 12; k++) {
    const r = dict.get(anchor - k);
    const p = dict.get(anchor - k - 12);
    if (r === undefined || p === undefined) continue;
    recent += r;
    prior += p;
    pairs++;
  }
  if (pairs < TREND_MIN_PAIRED_MONTHS || prior <= 0) return null;
  return mean ? { recent: recent / pairs, prior: prior / pairs } : { recent, prior };
}

export function localTrend(comps: ReadonlyArray<CompHistory>, anchor: number | null): LocalTrend | null {
  if (anchor === null || !Number.isFinite(anchor)) return null;
  const revenueChanges: number[] = [];
  const adrChanges: number[] = [];
  const occChanges: number[] = [];
  let recentTotal = 0;
  let priorTotal = 0;
  let rising = 0;

  for (const c of comps) {
    const rev = series(c.revenue_ltm_monthly);
    const priorStart = anchor - 23;
    let leadIn = 0;
    for (let i = priorStart - TREND_LEAD_IN_MONTHS; i < priorStart; i++) if (rev.has(i)) leadIn++;
    if (leadIn < TREND_MIN_LEAD_IN) continue;
    const r = pairedChange(rev, anchor, false);
    if (!r) continue;
    const change = r.recent / r.prior - 1;
    revenueChanges.push(change);
    recentTotal += r.recent;
    priorTotal += r.prior;
    if (change > 0) rising++;

    const adr = pairedChange(series(c.booked_daily_rate_ltm_monthly), anchor, true);
    if (adr) adrChanges.push(adr.recent / adr.prior - 1);
    const occDict = c.occupancy_rate_ltm_monthly;
    const occ = pairedChange(series(occDict), anchor, true);
    if (occ) occChanges.push((occ.recent - occ.prior) / occupancyScale(occDict));
  }

  if (revenueChanges.length < TREND_MIN_LISTINGS) return null;
  const revenueChange = median(revenueChanges)!;
  const enough = (v: number[]) => v.length >= TREND_MIN_LISTINGS;
  return {
    to: monthKey(anchor),
    listings: revenueChanges.length,
    revenueChange: Math.round(revenueChange * 1000) / 1000,
    adrChange: enough(adrChanges) ? Math.round(median(adrChanges)! * 1000) / 1000 : null,
    occupancyPointsChange: enough(occChanges) ? Math.round(median(occChanges)! * 1000) / 1000 : null,
    direction: revenueChange > TREND_FLAT_BAND ? 'up' : revenueChange < -TREND_FLAT_BAND ? 'down' : 'flat',
    rising,
    recentRevenue: Math.round(recentTotal),
    priorRevenue: Math.round(priorTotal),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function readLocalTrend(v: unknown): LocalTrend | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.to !== 'string' || !/^\d{4}-\d{2}$/.test(r.to)) return null;
  if (!finite(r.listings) || r.listings <= 0 || !finite(r.revenueChange)) return null;
  const direction = r.direction === 'up' || r.direction === 'down' || r.direction === 'flat' ? r.direction : null;
  if (!direction) return null;
  return {
    to: r.to,
    listings: r.listings,
    revenueChange: r.revenueChange,
    adrChange: finite(r.adrChange) ? r.adrChange : null,
    occupancyPointsChange: finite(r.occupancyPointsChange) ? r.occupancyPointsChange : null,
    direction,
    rising: finite(r.rising) ? r.rising : 0,
    recentRevenue: finite(r.recentRevenue) ? r.recentRevenue : 0,
    priorRevenue: finite(r.priorRevenue) ? r.priorRevenue : 0,
  };
}

function toLabel(t: LocalTrend): string {
  const [y, m] = t.to.split('-').map(Number);
  return monthLabel(y * 12 + m - 1);
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

function movement(t: LocalTrend): string {
  if (t.direction === 'flat') return 'about the same';
  return `about ${pct(t.revenueChange)} ${t.direction === 'up' ? 'more' : 'less'}`;
}

/** "Similar listings nearby earned about 8% more in the 12 months to Aug 2026 than in the 12 months before (11 listings)." */
export function trendSentence(t: LocalTrend): string {
  return `Similar listings nearby earned ${movement(t)} in the 12 months to ${toLabel(t)} than in the 12 months before (${t.listings} listings).`;
}

/** "Nightly rates up 5%, occupancy up 2 points." — null when neither is known. */
export function trendDetail(t: LocalTrend): string | null {
  const parts: string[] = [];
  if (t.adrChange !== null) {
    const a = t.adrChange;
    parts.push(Math.abs(a) < 0.01 ? 'nightly rates steady' : `nightly rates ${a > 0 ? 'up' : 'down'} ${pct(a)}`);
  }
  if (t.occupancyPointsChange !== null) {
    const pts = Math.round(t.occupancyPointsChange * 100);
    parts.push(pts === 0 ? 'occupancy steady' : `occupancy ${pts > 0 ? 'up' : 'down'} ${Math.abs(pts)} point${Math.abs(pts) === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;
  const s = parts.join(', ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** PDF-length: "Similar listings earned about 8% more in the year to Aug 2026 (11 listings)". */
export function trendShort(t: LocalTrend): string {
  return `Similar listings earned ${movement(t)} in the year to ${toLabel(t)} than the year before (${t.listings} listings)`;
}
