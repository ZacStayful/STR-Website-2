/**
 * UK wall-clock time, for the texting window.
 *
 * Texts go only between 08:00 and 20:00 UK time. Vercel's crons run in UTC,
 * so the window moves by an hour at each clock change; the cron runs all day
 * and this decides, from the real Europe/London time, whether a text may go
 * now. Intl does the daylight-saving arithmetic.
 *
 * Pure: no network, no database, no server-only.
 */

/** First hour a text may go (inclusive), UK time. */
export const WINDOW_START_HOUR = 8;
/** Texts stop at this hour (exclusive): 19:59 is the last minute. */
export const WINDOW_END_HOUR = 20;

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function londonParts(now: Date = new Date()): LondonParts {
  const get = (type: string) => Number(PARTS.formatToParts(now).find((p) => p.type === type)?.value ?? NaN);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** Whether a text may go now: 08:00 ≤ UK time < 20:00. */
export function inSendingWindow(now: Date = new Date()): boolean {
  const { hour } = londonParts(now);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/** The UK date, YYYY-MM-DD. */
export function londonDay(now: Date = new Date()): string {
  const p = londonParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The first day of the UK calendar month, YYYY-MM-01: the monthly cap's window starts here. */
export function londonMonthStart(now: Date = new Date()): string {
  const p = londonParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-01`;
}
