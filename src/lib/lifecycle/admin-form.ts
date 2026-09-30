/**
 * The Batch 20 settings form on /admin/lifecycle: what the admin typed, as
 * the billing_settings values to save, or why it cannot be saved. Dates are
 * typed in UK time (a datetime-local field) and saved as UTC instants.
 *
 * Pure: no network, no database, no server-only.
 */
import { LIFECYCLE_KEYS } from './settings.ts';

/** Minutes the UK is ahead of UTC at `at` (0 in winter, 60 in summer). */
export function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "2026-10-01T09:30" (or "2026-10-01") read as UK time, as an ISO instant; null when it is not a date. */
export function londonLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  if (h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const probe = new Date(guess);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  // The offset at the guessed instant, then once more at the corrected one (the hours around a clock change).
  let at = guess - londonOffsetMinutes(probe) * 60_000;
  at = guess - londonOffsetMinutes(new Date(at)) * 60_000;
  return new Date(at).toISOString();
}

/** An instant as the datetime-local field shows it, in UK time. */
export function isoToLondonLocal(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const local = new Date(t + londonOffsetMinutes(new Date(t)) * 60_000);
  return local.toISOString().slice(0, 16);
}

export type FormResult = { ok: true; values: Record<string, unknown>; summary: string[] } | { ok: false; message: string };

function whole(raw: string | null, min: number, label: string): number | string {
  const s = (raw ?? '').trim();
  const n = Number(s);
  if (s === '' || !Number.isInteger(n) || n < min) return `${label} must be a whole number of at least ${min}.`;
  return n;
}

/**
 * The form's fields: the two dates (with "now" boxes that set the current
 * time), the pack's price and credit in pence, the snooze days, the
 * low-credit pence and the two inactivity day counts.
 */
export function parseLifecycleForm(get: (name: string) => string | null, now: Date): FormResult {
  const dates: Record<string, string> = {};
  for (const [name, label] of [
    ['starter_pack_from', 'The starter pack start'],
    ['inactivity_from', 'The inactivity start'],
  ] as const) {
    if (get(`${name}_now`) === '1') {
      dates[name] = now.toISOString();
      continue;
    }
    const raw = (get(name) ?? '').trim();
    if (raw === '') {
      dates[name] = '';
      continue;
    }
    const iso = londonLocalToIso(raw);
    if (!iso) return { ok: false, message: `${label} is not a date and time.` };
    dates[name] = iso;
  }
  const price = whole(get('starter_pack_price_pence'), 1, 'The pack price');
  const credit = whole(get('starter_pack_credit_pence'), 1, 'The pack credit');
  const snooze = whole(get('starter_pack_snooze_days'), 1, '"Not now" days');
  const low = whole(get('low_credit_pence'), 0, 'The low-credit amount');
  const reengage = whole(get('inactive_reengage_days'), 1, 'Re-engage days');
  const pause = whole(get('picks_pause_inactive_days'), 1, 'Pause days');
  for (const v of [price, credit, snooze, low, reengage, pause]) if (typeof v === 'string') return { ok: false, message: v };
  if ((credit as number) < (price as number)) return { ok: false, message: 'The pack must give at least as much credit as it costs.' };
  const values: Record<string, unknown> = {
    [LIFECYCLE_KEYS.starterPackFrom]: dates.starter_pack_from,
    [LIFECYCLE_KEYS.starterPackPricePence]: price,
    [LIFECYCLE_KEYS.starterPackCreditPence]: credit,
    [LIFECYCLE_KEYS.starterPackSnoozeDays]: snooze,
    [LIFECYCLE_KEYS.lowCreditPence]: low,
    [LIFECYCLE_KEYS.inactiveReengageDays]: reengage,
    [LIFECYCLE_KEYS.picksPauseInactiveDays]: pause,
    [LIFECYCLE_KEYS.inactivityFrom]: dates.inactivity_from,
  };
  const summary = [
    dates.starter_pack_from ? `Starter pack for accounts created from ${dates.starter_pack_from}` : 'Starter pack off (new members get the welcome credit)',
    dates.inactivity_from ? `Inactivity counted from ${dates.inactivity_from}` : 'Inactivity rules off',
  ];
  return { ok: true, values, summary };
}
