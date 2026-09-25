/**
 * Stay length and changeovers by calendar month, from the comparables'
 * monthly booking counts. Display only: nothing here feeds cleaning costs or
 * any financial figure.
 *
 * Nights booked in a month are occupancy × days in the month, which
 * overstates nights for listings blocked part of the month, so comps
 * available most of the year are preferred when there are enough of them.
 *
 * Pure: loadable by `node --test`.
 */

import { calendarMonth, daysInMonth, DAYS_IN_MONTH, inWindow, monthKey, occupancyScale, series, type CompHistory, type MonthWindow } from './months.ts';

export const STAY_MIN_ACTIVE_DAYS = 300;
export const STAY_MIN_ESTABLISHED = 4;
export const STAY_MIN_LISTINGS_PER_MONTH = 3;
const MIN_NIGHTS = 1;
const MAX_NIGHTS = 30;

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface StayProfile {
  from: string;
  to: string;
  /** Nights per stay, Jan..Dec; null when too few listings. */
  months: (number | null)[];
  annual: number | null;
  listings: number;
  basis: 'established' | 'all';
}

const clamp = (v: number) => Math.round(Math.min(MAX_NIGHTS, Math.max(MIN_NIGHTS, v)) * 10) / 10;

export function stayProfile(comps: ReadonlyArray<CompHistory>, w: MonthWindow | null): StayProfile | null {
  if (!w) return null;
  const withBookings = comps.filter((c) => series(c.no_of_bookings_ltm_monthly).size > 0);
  const established = withBookings.filter((c) => (c.active_days_count_ltm ?? 0) >= STAY_MIN_ACTIVE_DAYS);
  const pool = established.length >= STAY_MIN_ESTABLISHED ? established : withBookings;
  const basis: StayProfile['basis'] = pool === established ? 'established' : 'all';

  const nights = new Array(12).fill(0);
  const bookings = new Array(12).fill(0);
  const contributors: Set<number>[] = Array.from({ length: 12 }, () => new Set<number>());
  const used = new Set<number>();

  pool.forEach((c, ci) => {
    const b = series(c.no_of_bookings_ltm_monthly);
    const occDict = c.occupancy_rate_ltm_monthly;
    const occ = series(occDict);
    const scale = occupancyScale(occDict);
    for (const [i, count] of b) {
      if (!inWindow(i, w)) continue;
      const o = occ.get(i);
      if (o === undefined) continue;
      const n = (o / scale) * daysInMonth(i);
      if (n < count) continue;
      const m = calendarMonth(i);
      nights[m] += n;
      bookings[m] += count;
      contributors[m].add(ci);
      used.add(ci);
    }
  });

  const months = nights.map((n, m) => (contributors[m].size >= STAY_MIN_LISTINGS_PER_MONTH && bookings[m] > 0 ? clamp(n / bookings[m]) : null));
  if (months.every((v) => v === null)) return null;
  const totalBookings = bookings.reduce((s, v) => s + v, 0);
  const annual = totalBookings > 0 ? clamp(nights.reduce((s, v) => s + v, 0) / totalBookings) : null;
  return {
    from: monthKey(w.end - w.months + 1),
    to: monthKey(w.end),
    months,
    annual,
    listings: used.size,
    basis,
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function readStayProfile(v: unknown): StayProfile | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.months) || r.months.length !== 12) return null;
  const months = r.months.map((x) => (finite(x) && x >= MIN_NIGHTS && x <= MAX_NIGHTS ? x : null));
  if (months.every((x) => x === null)) return null;
  return {
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
    months,
    annual: finite(r.annual) && r.annual >= MIN_NIGHTS && r.annual <= MAX_NIGHTS ? r.annual : null,
    listings: finite(r.listings) ? r.listings : 0,
    basis: r.basis === 'established' ? 'established' : 'all',
  };
}

/** Exactly 12 finite values in [0, 1], else null. */
export function readMonthlyOccupancy(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 12) return null;
  if (!v.every((x) => finite(x) && x >= 0 && x <= 1)) return null;
  return v as number[];
}

export interface MonthTurnovers {
  month: number;
  stay: number | null;
  nights: number;
  turnovers: number | null;
}

/** Changeovers per month at this report's forecast occupancy. */
export function turnoversByMonth(i: { monthlyOccupancy: readonly number[] | null; occupancyRate: number; profile: StayProfile }): { months: MonthTurnovers[]; annual: number | null } {
  const occ = i.monthlyOccupancy;
  const months = DAYS_IN_MONTH.map((days, m) => {
    const o = occ ? occ[m] : i.occupancyRate;
    const nights = Math.round((finite(o) ? o : 0) * days);
    const stay = i.profile.months[m] ?? i.profile.annual;
    return { month: m, stay: i.profile.months[m], nights, turnovers: stay ? Math.round(nights / stay) : null };
  });
  const known = months.filter((m) => m.turnovers !== null);
  const annual = known.length === 12 ? known.reduce((s, m) => s + (m.turnovers ?? 0), 0) : null;
  return { months, annual };
}

/** Average stay from the comps' annual bookings (the report's figure before month-by-month data). */
export function legacyAvgStayNights(comps: ReadonlyArray<{ bookings?: number; daysAvailable: number; occupancyRate: number }>): number | null {
  const safe = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const stayLengths = comps
    .map((c) => {
      const bookings = safe(c.bookings);
      const nights = safe(c.daysAvailable) * safe(c.occupancyRate);
      return bookings > 0 && nights > 0 ? nights / bookings : null;
    })
    .filter((n): n is number => n !== null && n >= 1 && n <= 30);
  return stayLengths.length > 0 ? stayLengths.reduce((a, b) => a + b, 0) / stayLengths.length : null;
}

/** The stored month-by-month profile's figure when present, else the legacy one. */
export function reportAvgStayNights(s: { stayProfile?: unknown; comparables?: ReadonlyArray<{ bookings?: number; daysAvailable: number; occupancyRate: number }> | null }): number | null {
  const p = readStayProfile(s.stayProfile);
  if (p?.annual) return p.annual;
  return legacyAvgStayNights(s.comparables ?? []);
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** One plain-English line for the analyser. */
export function staySentence(p: StayProfile, t: { months: MonthTurnovers[]; annual: number | null } | null): string {
  const parts: string[] = [];
  const known = p.months.map((v, m) => ({ v, m })).filter((x): x is { v: number; m: number } => x.v !== null);
  const avg = p.annual ?? (known.length ? known.reduce((s, x) => s + x.v, 0) / known.length : null);
  if (avg !== null) {
    let line = `Guests at similar listings stay about ${fmt(avg)} nights on average`;
    if (known.length >= 6) {
      const hi = known.reduce((a, b) => (b.v > a.v ? b : a));
      const lo = known.reduce((a, b) => (b.v < a.v ? b : a));
      if (hi.v - lo.v >= 0.3) line += `, longest in ${MONTH_LONG[hi.m]} (${fmt(hi.v)}) and shortest in ${MONTH_LONG[lo.m]} (${fmt(lo.v)})`;
    }
    parts.push(`${line}.`);
  }
  if (t?.annual) {
    parts.push(`At our forecast occupancy that's roughly ${Math.round(t.annual / 12)} changeovers a month (about ${t.annual} a year).`);
  }
  return parts.join(' ');
}
