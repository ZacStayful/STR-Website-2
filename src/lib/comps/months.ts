/**
 * Month windowing over the "YYYY-MM"-keyed histories Airbtics attaches to
 * each report comparable (`revenue_ltm_monthly` and friends). Despite the
 * "ltm" in the names these run back to 2021, so anything that folds them into
 * calendar months has to choose a window first — otherwise the 2021 lockdown
 * months shape the seasonal curve.
 *
 * Pure: no server-only imports, so `node --test` can load it.
 */

export type MonthlyDict = Record<string, number | null | undefined>;

/** Inclusive window of `months` months ending at absolute index `end` (year*12 + month0). */
export interface MonthWindow {
  end: number;
  months: number;
}

/** A report comp's history, structurally. `ReportComp` in airbtics.ts satisfies it. */
export interface CompHistory {
  revenue_ltm_monthly?: MonthlyDict | null;
  /** 0–100 (a dict whose values are all ≤ 1 is read as 0–1). */
  occupancy_rate_ltm_monthly?: MonthlyDict | null;
  booked_daily_rate_ltm_monthly?: MonthlyDict | null;
  no_of_bookings_ltm_monthly?: MonthlyDict | null;
  active_days_count_ltm?: number | null;
}

export const SEASONAL_WINDOW_MONTHS = 36;

/** Days per calendar month on the forecast's (non-leap) calendar. */
export const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Typical UK seasonal pattern, used when the comps carry too little history. */
export const UK_DEFAULT_SEASONAL_MULTIPLIERS: readonly number[] = [0.82, 0.85, 0.95, 1.00, 1.08, 1.18, 1.25, 1.22, 1.10, 0.98, 0.88, 0.80];

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08" (also "2026-8", "2026-08-01") → absolute month index; null if unparseable. */
export function monthIndex(key: string): number | null {
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

export function monthKey(index: number): string {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthLabel(index: number): string {
  const year = Math.floor(index / 12);
  return `${MONTH_SHORT[index - year * 12]} ${year}`;
}

/** Calendar month 0–11. */
export function calendarMonth(index: number): number {
  return ((index % 12) + 12) % 12;
}

/** Days in that actual month (leap-aware). */
export function daysInMonth(index: number): number {
  const year = Math.floor(index / 12);
  const m = calendarMonth(index);
  if (m === 1) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return DAYS_IN_MONTH[m];
}

/** The positive, finite values of a dict, keyed by absolute month index. */
export function series(dict: MonthlyDict | null | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!dict || typeof dict !== 'object') return out;
  for (const [key, value] of Object.entries(dict)) {
    const i = monthIndex(key);
    if (i === null) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out.set(i, value);
  }
  return out;
}

/** Whether a month falls in the window. A null window means everything. */
export function inWindow(index: number, w: MonthWindow | null | undefined): boolean {
  if (!w) return true;
  return index <= w.end && index > w.end - w.months;
}

export function windowEndingAt(end: number | null, months: number): MonthWindow | null {
  if (end === null || !Number.isFinite(end) || months <= 0) return null;
  return { end, months };
}

/** "2023-09..2026-08", for logs. */
export function windowLabel(w: MonthWindow): string {
  return `${monthKey(w.end - w.months + 1)}..${monthKey(w.end)}`;
}

/**
 * The latest month strictly before the current UTC month in which at least
 * `minCoverage` of the dicts that carry any data have a positive value. The
 * anchor comes from the data itself — Airbtics lags a month or two — and a
 * thinly populated trailing month is passed over.
 */
export function latestCompleteMonth(
  dicts: ReadonlyArray<MonthlyDict | null | undefined>,
  now: Date,
  minCoverage = 0.5,
): number | null {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const all = dicts.map(series).filter((s) => s.size > 0);
  if (all.length === 0) return null;
  const counts = new Map<number, number>();
  for (const s of all) {
    for (const i of s.keys()) {
      if (i < current) counts.set(i, (counts.get(i) ?? 0) + 1);
    }
  }
  const months = [...counts.keys()].sort((a, b) => b - a);
  for (const i of months) {
    if ((counts.get(i) ?? 0) / all.length >= minCoverage) return i;
  }
  return null;
}

/**
 * Mean of each calendar month's positive values (Jan..Dec), within the
 * window. Null when fewer than 3 calendar months carry data.
 * (Formerly `revenueDictToArray` in airbtics.ts.)
 */
export function calendarMonthMeans(dict: MonthlyDict | null | undefined, w?: MonthWindow | null): number[] | null {
  if (!dict) return null;
  const out: number[] = new Array(12).fill(0);
  const counts: number[] = new Array(12).fill(0);
  for (const [i, value] of series(dict)) {
    if (!inWindow(i, w)) continue;
    const mi = calendarMonth(i);
    out[mi] += value;
    counts[mi] += 1;
  }
  for (let i = 0; i < 12; i++) {
    if (counts[i] > 0) out[i] /= counts[i];
  }
  const nonZero = out.filter((v) => v > 0).length;
  if (nonZero < 3) return null;
  return out;
}

/**
 * multiplier[month] = monthAverage / annualAverage, pooling every dict's
 * values in the window. Falls back to the UK default pattern when fewer than
 * six calendar months carry data. (Formerly `buildSeasonalMultipliers`.)
 */
export function seasonalMultipliers(dicts: ReadonlyArray<MonthlyDict | null | undefined>, w?: MonthWindow | null): number[] {
  const monthTotals: number[] = new Array(12).fill(0);
  const monthCounts: number[] = new Array(12).fill(0);
  for (const dict of dicts) {
    for (const [i, value] of series(dict)) {
      if (!inWindow(i, w)) continue;
      const mi = calendarMonth(i);
      monthTotals[mi] += value;
      monthCounts[mi]++;
    }
  }
  const monthAverages = monthTotals.map((total, i) => (monthCounts[i] > 0 ? total / monthCounts[i] : 0));
  const validMonths = monthAverages.filter((v) => v > 0);
  if (validMonths.length < 6) return [...UK_DEFAULT_SEASONAL_MULTIPLIERS];
  const annualAverage = validMonths.reduce((s, v) => s + v, 0) / validMonths.length;
  return monthAverages.map((v) => (v > 0 ? v / annualAverage : 1.0));
}

/** Occupancy as a 0–1 fraction whether the dict is on a 0–100 or 0–1 scale. */
export function occupancyScale(dict: MonthlyDict | null | undefined): number {
  const values = [...series(dict).values()];
  return values.length > 0 && values.every((v) => v <= 1) ? 1 : 100;
}
