/**
 * The monthly credit slots of an annual plan (Batch 21, B8). An annual plan
 * is paid once and credited month by month: the webhook grants the first
 * month and the 03:00 sweep grants the rest, each keyed on the calendar
 * month its slot starts in (`annual:<subscription>:<YYYY-MM>`).
 *
 * Adding a month with Date.setUTCMonth overflows: 31 January + 1 month is
 * 3 March, so a period starting on the 29th, 30th or 31st had two slots
 * keyed on the same month (the second was refused as a replay) and a slot
 * index that stalled; a 31st start got 7 of its 12 months. Here a month is
 * added with the day clamped to the target month's last day, so the twelve
 * slot starts fall in twelve consecutive months and cover the year.
 *
 * Pure, so the arithmetic is tested for every start day.
 */

/** `date` plus `n` calendar months, the day clamped to the target month's last day; the time of day is kept (UTC). */
export function addMonthsClamped(date: Date, n: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
}

export interface AnnualSlot {
  /** 0 to 11. */
  slot: number;
  from: Date;
  /** The next slot's start, or the period end for the last slot. */
  to: Date;
  /** YYYY-MM of `from`: the grant's source_ref suffix, as the webhook keys the first month. */
  key: string;
}

/** The twelve slots of the period [start, end). */
export function annualSlots(start: Date, end: Date): AnnualSlot[] {
  const out: AnnualSlot[] = [];
  for (let slot = 0; slot < 12; slot++) {
    const from = addMonthsClamped(start, slot);
    const next = addMonthsClamped(start, slot + 1);
    const to = slot === 11 || next.getTime() > end.getTime() ? end : next;
    out.push({ slot, from, to, key: from.toISOString().slice(0, 7) });
  }
  return out;
}

/** The slot `now` falls in, or null before the period starts or once it has ended. */
export function annualSlotAt(start: Date, end: Date, now: Date): AnnualSlot | null {
  if (now.getTime() < start.getTime() || now.getTime() >= end.getTime()) return null;
  return annualSlots(start, end).find((s) => now.getTime() >= s.from.getTime() && now.getTime() < s.to.getTime()) ?? null;
}
