/**
 * Weeks as Batch 9 counts them: Monday 00:00 to Sunday 23:59, UK time
 * (Europe/London), so a week around a clock change is 167 or 169 hours long.
 * The database groups by the same rule (date_trunc('week', t at time zone
 * 'Europe/London')), and a week is always named by its Monday, YYYY-MM-DD.
 *
 * Pure: no network, no database, no server-only.
 */
import { londonDay } from '../sms/uk-time.ts';
import { londonDayStart } from '../leads/search.ts';

/** The UK calendar date an instant falls on, YYYY-MM-DD. */
export function ukDay(at: Date): string {
  return londonDay(at);
}

/** YYYY-MM-DD moved by `n` calendar days. Dates only: no time zone is involved. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the UK week an instant falls in. */
export function ukWeekStart(at: Date): string {
  const day = ukDay(at);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((dow + 6) % 7));
}

/** The instants a UK week runs between: [Monday 00:00, the next Monday 00:00). */
export function ukWeekRange(weekStart: string): { start: Date; end: Date } {
  const start = londonDayStart(weekStart);
  const end = londonDayStart(addDays(weekStart, 7));
  if (!start || !end) throw new Error(`Not a date: ${weekStart}`);
  return { start, end };
}

/** The `n` weeks up to and including the one `now` is in, oldest first. */
export function recentWeeks(now: Date, n: number): string[] {
  const thisWeek = ukWeekStart(now);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(thisWeek, (i - n + 1) * 7));
}

/** The seven UK dates of a week, Monday first. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** The `n` UK dates ending on `day`, `day` included, oldest first. */
export function daysEnding(day: string, n: number): string[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(day, i - n + 1));
}

/** "22 Sep": a week by its Monday. */
export function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
