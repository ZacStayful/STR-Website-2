/**
 * Earnings ranges: what similar listings earn, and the single definition of
 * "top 25%" every surface uses (web Beat boxes, Top badges, PDF Beat and TOP
 * pills). Percentiles are the interpolated ("type 7") quantile, the same
 * maths as the competitors panel.
 *
 * The population is the report's displayed comparables, so the band never
 * contradicts the comp table next to it. Pure: loadable by `node --test`.
 */

import { calendarMonth, inWindow, monthKey, series, type MonthlyDict, type MonthWindow } from './months.ts';

export const MIN_RANGE_LISTINGS = 6;
export const MIN_TOP_TEN_LISTINGS = 10;
export const MIN_MONTH_LISTINGS = 5;
export const MIN_TOP_BADGE_LISTINGS = 4;

export interface AnnualEarningsRange {
  p25: number;
  p50: number;
  p75: number;
  /** Null below MIN_TOP_TEN_LISTINGS — a 90th percentile of a handful is just the maximum. */
  p90: number | null;
  n: number;
}

/** Calendar months Jan..Dec; a month with too few listings is null. */
export interface MonthlyEarningsRange {
  /** "YYYY-MM", the last month of the 12-month window. */
  to: string;
  p25: (number | null)[];
  p50: (number | null)[];
  p75: (number | null)[];
  n: number[];
}

export interface EarningsRange {
  basis: 'comparables';
  annual: AnnualEarningsRange | null;
  monthly: MonthlyEarningsRange | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Interpolated quantile (type 7). Non-finite values are dropped. */
export function quantile(values: readonly number[], q: number): number | null {
  const s = values.filter(finite).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * Where x sits in values, 0–1: the exact inverse of `quantile` inside the
 * range, 0 below the minimum, 1 above the maximum. Ties land in the middle
 * of their run.
 */
export function percentileRank(values: readonly number[], x: number): number | null {
  const s = values.filter(finite).sort((a, b) => a - b);
  if (s.length === 0 || !finite(x)) return null;
  if (s.length === 1) return x < s[0] ? 0 : x > s[0] ? 1 : 0.5;
  if (x <= s[0]) return x < s[0] ? 0 : tieMiddle(s, x);
  if (x >= s[s.length - 1]) return x > s[s.length - 1] ? 1 : tieMiddle(s, x);
  const first = s.findIndex((v) => v >= x);
  if (s[first] === x) return tieMiddle(s, x);
  const lo = first - 1;
  const frac = (x - s[lo]) / (s[first] - s[lo]);
  return (lo + frac) / (s.length - 1);
}

function tieMiddle(s: number[], x: number): number {
  const first = s.indexOf(x);
  const last = s.lastIndexOf(x);
  return ((first + last) / 2) / (s.length - 1);
}

const round1 = (v: number) => Math.round(v);

/** P25/P50/P75(/P90) of annual revenues; positive values only. Null below MIN_RANGE_LISTINGS. */
export function annualEarningsRange(revenues: readonly number[]): AnnualEarningsRange | null {
  const kept = revenues.filter((v) => finite(v) && v > 0);
  if (kept.length < MIN_RANGE_LISTINGS) return null;
  const p90 = kept.length >= MIN_TOP_TEN_LISTINGS ? quantile(kept, 0.9) : null;
  return {
    p25: round1(quantile(kept, 0.25)!),
    p50: round1(quantile(kept, 0.5)!),
    p75: round1(quantile(kept, 0.75)!),
    p90: p90 === null ? null : round1(p90),
    n: kept.length,
  };
}

/**
 * Month-by-month P25/P50/P75 across comps over a 12-month window. Each
 * comp's months are multiplied by `scale` (its displayed ÷ raw annual
 * revenue) so the band is in the same units as the comp table.
 */
export function monthlyEarningsRange(
  comps: ReadonlyArray<{ revenue: MonthlyDict | null | undefined; scale?: number }>,
  w: MonthWindow,
): MonthlyEarningsRange | null {
  const window: MonthWindow = { end: w.end, months: 12 };
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const c of comps) {
    const scale = finite(c.scale) && c.scale > 0 ? c.scale : 1;
    for (const [i, v] of series(c.revenue)) {
      if (inWindow(i, window)) byMonth[calendarMonth(i)].push(v * scale);
    }
  }
  const n = byMonth.map((vals) => vals.length);
  if (n.filter((k) => k >= MIN_MONTH_LISTINGS).length < 6) return null;
  const pick = (q: number) => byMonth.map((vals) => (vals.length >= MIN_MONTH_LISTINGS ? round1(quantile(vals, q)!) : null));
  return {
    to: monthKey(w.end),
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    n,
  };
}

function readAnnual(v: unknown): AnnualEarningsRange | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!finite(r.p25) || !finite(r.p50) || !finite(r.p75) || !finite(r.n)) return null;
  if (!(r.p25 <= r.p50 && r.p50 <= r.p75)) return null;
  const p90 = finite(r.p90) && r.p90 >= r.p75 ? r.p90 : null;
  return { p25: r.p25, p50: r.p50, p75: r.p75, p90, n: r.n };
}

function readMonthly(v: unknown): MonthlyEarningsRange | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const arr = (a: unknown) => (Array.isArray(a) && a.length === 12 ? a.map((x) => (finite(x) ? x : null)) : null);
  const p25 = arr(r.p25);
  const p50 = arr(r.p50);
  const p75 = arr(r.p75);
  if (!p25 || !p50 || !p75 || typeof r.to !== 'string') return null;
  const n = Array.isArray(r.n) && r.n.length === 12 ? r.n.map((x) => (finite(x) ? x : 0)) : new Array(12).fill(0);
  return { to: r.to, p25, p50, p75, n };
}

/** Validates a stored value; anything malformed reads as null. */
export function readEarningsRange(v: unknown): EarningsRange | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const annual = readAnnual(r.annual);
  const monthly = readMonthly(r.monthly);
  if (!annual && !monthly) return null;
  return { basis: 'comparables', annual, monthly };
}

/**
 * The range for a report: the stored one when valid, otherwise the annual
 * range derived from its comparables (so reports saved before this field
 * existed still get the annual band; the monthly band needs history they
 * don't carry).
 */
export function earningsRangeOf(s: {
  earningsRange?: unknown;
  comparables?: ReadonlyArray<{ annualRevenue: number }> | null;
}): { annual: AnnualEarningsRange | null; monthly: MonthlyEarningsRange | null } {
  const stored = readEarningsRange(s.earningsRange);
  const derived = annualEarningsRange((s.comparables ?? []).map((c) => c.annualRevenue));
  return { annual: stored?.annual ?? derived, monthly: stored?.monthly ?? null };
}

export interface EstimatePosition {
  /** 0–1. */
  rank: number;
  /** Rounded to the nearest 5. */
  percentile: number;
  phrase: string;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function positionPhrase(rank: number): string {
  if (rank < 0.1) return 'below most similar listings';
  if (rank > 0.9) return 'above most similar listings';
  return `about the ${ordinal(Math.round((rank * 100) / 5) * 5)} percentile`;
}

export function estimatePosition(revenues: readonly number[], estimate: number): EstimatePosition | null {
  const kept = revenues.filter((v) => finite(v) && v > 0);
  if (kept.length < MIN_RANGE_LISTINGS || !finite(estimate) || estimate <= 0) return null;
  const rank = percentileRank(kept, estimate);
  if (rank === null) return null;
  return { rank, percentile: Math.round((rank * 100) / 5) * 5, phrase: positionPhrase(rank) };
}

/**
 * Horizontal positions (0–1) for drawing the band. The axis runs from a
 * little below P25 to a little above the highest marker, so the band and
 * the estimate always fit. Never NaN.
 */
export function bandPositions(r: AnnualEarningsRange, estimate: number): { p25: number; p50: number; p75: number; p90: number | null; estimate: number } {
  const top = Math.max(r.p90 ?? r.p75, finite(estimate) ? estimate : r.p75, r.p75);
  const bottom = Math.min(r.p25, finite(estimate) ? estimate : r.p25);
  const span = top - bottom;
  const pad = span > 0 ? span * 0.12 : Math.max(1, Math.abs(top) * 0.1);
  const lo = bottom - pad;
  const hi = top + pad;
  const at = (v: number) => {
    const p = (v - lo) / (hi - lo);
    return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5;
  };
  return {
    p25: at(r.p25),
    p50: at(r.p50),
    p75: at(r.p75),
    p90: r.p90 === null ? null : at(r.p90),
    estimate: at(finite(estimate) ? estimate : r.p50),
  };
}

export interface BeatTargets {
  nightly: number;
  /** 0–1. */
  occupancy: number;
  revenue: number;
}

/** Where the top 25% start, per metric (P75 of each). Null with no comps. */
export function beatTargets(comps: ReadonlyArray<{ averageDailyRate: number; occupancyRate: number; annualRevenue: number }>): BeatTargets | null {
  if (comps.length === 0) return null;
  const nightly = quantile(comps.map((c) => c.averageDailyRate), 0.75);
  const occupancy = quantile(comps.map((c) => c.occupancyRate), 0.75);
  const revenue = quantile(comps.map((c) => c.annualRevenue), 0.75);
  if (nightly === null || occupancy === null || revenue === null) return null;
  return { nightly: Math.round(nightly), occupancy, revenue: Math.round(revenue) };
}

/** The revenue a comp needs to be in the top 25% (P75). */
export function topQuarterThreshold(revenues: readonly number[]): number | null {
  return quantile(revenues.filter((v) => finite(v) && v > 0), 0.75);
}
