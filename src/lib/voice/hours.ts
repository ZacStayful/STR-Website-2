/**
 * Batch 23: when Stayful Intelligence may place a call. Outbound calls only
 * on the settings' weekdays, between the settings' UK hours (default
 * Monday–Friday 09:00–19:00). Callbacks are answered at any hour and never
 * pass through here. UK bank holidays count as weekdays (Q9).
 *
 * Pure: Intl does the clock-change arithmetic (src/lib/sms/uk-time.ts).
 */
import { londonDay, londonParts } from '../sms/uk-time.ts';
import type { VoiceSettings } from './settings.ts';

type Hours = Pick<VoiceSettings, 'outboundStartHour' | 'outboundEndHour' | 'outboundWeekdays'>;

/** ISO weekday in the UK (1 = Monday … 7 = Sunday). */
export function ukWeekday(now: Date): number {
  const p = londonParts(now);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The UK date, YYYY-MM-DD: the one-call-a-day rule's day. */
export function ukDay(now: Date): string {
  return londonDay(now);
}

export function inOutboundHours(now: Date, s: Hours): boolean {
  if (!s.outboundWeekdays.includes(ukWeekday(now))) return false;
  const { hour } = londonParts(now);
  return hour >= s.outboundStartHour && hour < s.outboundEndHour;
}

/** Now, if inside hours; else the start of the next opening (UK offsets are whole hours, so hour steps find it). */
export function nextOpening(now: Date, s: Hours): Date {
  if (inOutboundHours(now, s)) return now;
  const top = new Date(now);
  top.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 24 * 9; i++) {
    const at = new Date(top.getTime() + i * 3_600_000);
    if (inOutboundHours(at, s)) return at;
  }
  return new Date(now.getTime() + 7 * 24 * 3_600_000);
}

/** The first opening on a later UK day than `now` (today's one call is used). */
export function nextDayOpening(now: Date, s: Hours): Date {
  const today = ukDay(now);
  const top = new Date(now);
  top.setUTCMinutes(0, 0, 0);
  for (let i = 1; i <= 24 * 10; i++) {
    const at = new Date(top.getTime() + i * 3_600_000);
    if (ukDay(at) !== today && inOutboundHours(at, s)) return at;
  }
  return new Date(now.getTime() + 7 * 24 * 3_600_000);
}
