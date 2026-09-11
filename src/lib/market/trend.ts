/**
 * Direction of travel for a monthly series — honest by construction.
 *
 * For value metrics (ADR, occupancy, revenue) a month only counts when it is
 * backed by at least `minSamplesPerMonth` reports and has a value. The mean
 * of the last `window` qualifying months is compared with the mean of the
 * `window` before those; fewer than two qualifying months on either side is
 * `insufficient`, never a guessed arrow. For report volume (enquiries) the
 * windows are positional (a zero month is real information) and the prior
 * window must hold at least `minSamplesPerMonth` reports to be a baseline.
 * Moves inside `flatBand` are "flat".
 */

import type { MonthBucket } from './types.ts';

export type Direction = 'up' | 'flat' | 'down' | 'insufficient';

/** The one phrase for an enquiry direction, used by rows, cards and verdicts alike. */
export function trendLabel(direction: Direction | null | undefined): string | null {
  if (!direction) return null;
  return { up: 'Rising enquiries', down: 'Enquiries falling', flat: 'Steady enquiries', insufficient: 'Building history' }[direction];
}
export type TrendMetric = 'reports' | 'avg_adr' | 'avg_occupancy' | 'avg_gross_revenue';

export interface TrendResult {
  direction: Direction;
  deltaPct: number | null; // recent vs prior, e.g. 0.12 = +12%
  recent: number | null;
  prior: number | null;
  monthsUsed: number; // qualifying months that fed the comparison
  recentMonths: number; // months in the recent window
  priorMonths: number; // months in the prior window
}

export interface TrendOptions {
  minSamplesPerMonth: number;
  window: number;
  flatBand: number;
  /** Drop the final bucket (the running, partial month) before comparing. */
  excludeLast: boolean;
}

export const DEFAULT_TREND_OPTIONS: TrendOptions = { minSamplesPerMonth: 3, window: 3, flatBand: 0.03, excludeLast: false };

const INSUFFICIENT: TrendResult = { direction: 'insufficient', deltaPct: null, recent: null, prior: null, monthsUsed: 0, recentMonths: 0, priorMonths: 0 };

function mean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function direction(delta: number, flatBand: number): Direction {
  if (delta > flatBand) return 'up';
  if (delta < -flatBand) return 'down';
  return 'flat';
}

export function trendDirection(input: MonthBucket[], metric: TrendMetric, opts: Partial<TrendOptions> = {}): TrendResult {
  const o = { ...DEFAULT_TREND_OPTIONS, ...opts };
  const series = o.excludeLast ? input.slice(0, -1) : input;
  if (metric === 'reports') {
    if (series.length < o.window * 2) return INSUFFICIENT;
    const recentMonths = series.slice(-o.window);
    const priorMonths = series.slice(-o.window * 2, -o.window);
    const recent = recentMonths.reduce((s, b) => s + b.reports, 0);
    const prior = priorMonths.reduce((s, b) => s + b.reports, 0);
    if (prior < o.minSamplesPerMonth) return { ...INSUFFICIENT, recent, prior, monthsUsed: o.window * 2, recentMonths: o.window, priorMonths: o.window };
    const delta = (recent - prior) / prior;
    return { direction: direction(delta, o.flatBand), deltaPct: Math.round(delta * 1000) / 1000, recent, prior, monthsUsed: o.window * 2, recentMonths: o.window, priorMonths: o.window };
  }
  const qualifying = series.filter((b) => b.reports >= o.minSamplesPerMonth && b[metric] !== null).map((b) => b[metric] as number);
  const recentVals = qualifying.slice(-o.window);
  const priorVals = qualifying.slice(-o.window * 2, -o.window);
  if (recentVals.length < 2 || priorVals.length < 2) return { ...INSUFFICIENT, monthsUsed: qualifying.length };
  const recent = mean(recentVals);
  const prior = mean(priorVals);
  if (prior === 0) return { ...INSUFFICIENT, recent, prior, monthsUsed: recentVals.length + priorVals.length, recentMonths: recentVals.length, priorMonths: priorVals.length };
  const delta = (recent - prior) / prior;
  return {
    direction: direction(delta, o.flatBand),
    deltaPct: Math.round(delta * 1000) / 1000,
    recent: Math.round(recent * 10) / 10,
    prior: Math.round(prior * 10) / 10,
    monthsUsed: recentVals.length + priorVals.length,
    recentMonths: recentVals.length,
    priorMonths: priorVals.length,
  };
}

export interface AreaTrend {
  enquiries: TrendResult;
  revenue: TrendResult;
  adr: TrendResult;
  occupancy: TrendResult;
  /** Months (in the window) with at least one report. */
  monthsWithData: number;
  /** First month with data, or null. */
  since: string | null;
  series: MonthBucket[];
}

/**
 * Per-area summary. The API's last bucket is the running month, so it is
 * excluded from every direction (a partial month would read as a drop at
 * the start of each month); it still shows in the charts.
 */
export function areaTrend(series: MonthBucket[] | undefined, opts: Partial<TrendOptions> = {}): AreaTrend | null {
  if (!series || series.length === 0) return null;
  const withData = series.filter((b) => b.reports > 0);
  const o = { excludeLast: true, ...opts };
  return {
    enquiries: trendDirection(series, 'reports', o),
    revenue: trendDirection(series, 'avg_gross_revenue', o),
    adr: trendDirection(series, 'avg_adr', o),
    occupancy: trendDirection(series, 'avg_occupancy', o),
    monthsWithData: withData.length,
    since: withData[0]?.month ?? null,
    series,
  };
}

export interface Pulse {
  thisMonth: number; // reports so far this month
  lastMonth: number;
  prevMonth: number;
  enquiries: TrendResult; // last full month vs the one before
  adr: TrendResult;
  occupancy: TrendResult;
  revenue: TrendResult;
  since: string | null;
  latestAdr: number | null;
  latestOccupancy: number | null;
}

/** Nationwide pulse: last full month against the month before, plus the running month. */
export function pulse(national: MonthBucket[], opts: Partial<TrendOptions> = {}): Pulse | null {
  if (national.length < 3) return null;
  const cur = national[national.length - 1];
  const last = national[national.length - 2];
  const prev = national[national.length - 3];
  const o = { ...DEFAULT_TREND_OPTIONS, ...opts };
  let enquiries: TrendResult = INSUFFICIENT;
  if (prev.reports >= o.minSamplesPerMonth) {
    const delta = (last.reports - prev.reports) / prev.reports;
    enquiries = { direction: direction(delta, o.flatBand), deltaPct: Math.round(delta * 1000) / 1000, recent: last.reports, prior: prev.reports, monthsUsed: 2, recentMonths: 1, priorMonths: 1 };
  }
  const withData = national.filter((b) => b.reports > 0);
  const latest = [...national].reverse().find((b) => b.reports >= o.minSamplesPerMonth) ?? null;
  const full = { excludeLast: true, ...opts };
  return {
    thisMonth: cur.reports,
    lastMonth: last.reports,
    prevMonth: prev.reports,
    enquiries,
    adr: trendDirection(national, 'avg_adr', full),
    occupancy: trendDirection(national, 'avg_occupancy', full),
    revenue: trendDirection(national, 'avg_gross_revenue', full),
    since: withData[0]?.month ?? null,
    latestAdr: latest?.avg_adr ?? null,
    latestOccupancy: latest?.avg_occupancy ?? null,
  };
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(m ?? 1) - 1]} ${y}`;
}
