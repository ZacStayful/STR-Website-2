/**
 * Batch 23: the calls' billing_settings rows, one parser
 * (BillingSettings.voice). Seeded in supabase/schema.sql's Batch 23 section;
 * edited on /admin/calls. A malformed value falls back to its default.
 *
 * Reused, not duplicated here: low_credit_pence (lifecycle), the £25 / £5
 * auto top-up and the text / email prices (intelligence), and
 * feedback_admin_email (src/lib/feedback) as the handoff address.
 *
 * Pure.
 */

export interface VoiceSettings {
  /** Outbound calls only from this UK hour (inclusive)… */
  outboundStartHour: number;
  /** …to this UK hour (exclusive). */
  outboundEndHour: number;
  /** ISO weekdays outbound calls may be placed on (1 = Monday … 7 = Sunday). */
  outboundWeekdays: number[];
  /** Outbound calls of any type per member per UK day. */
  maxOutboundPerUkDay: number;
  /** The low-credit trigger: this share of the most recent credit spent… */
  lowCreditSpentRatio: number;
  /** …within this many days of it landing. */
  lowCreditWindowDays: number;
  /** No low-credit call in a member's first this-many days. */
  lowCreditMinMemberDays: number;
  /** The longest call, either way. */
  maxCallSeconds: number;
  /** Texts the agent may send in one call. */
  textsPerCallMax: number;
  /** The agent starts wrapping up this long before the limit. */
  wrapUpSeconds: number;
  /** Turns are deleted after this many days; questions and outcomes are kept. */
  transcriptRetentionDays: number;
  /** Automatic text replies per number per UK day. */
  smsAutoRepliesPerNumberDay: number;
}

export const VOICE_KEYS = {
  outboundStartHour: 'si_outbound_start_hour',
  outboundEndHour: 'si_outbound_end_hour',
  outboundWeekdays: 'si_outbound_weekdays',
  maxOutboundPerUkDay: 'si_max_outbound_calls_per_uk_day',
  lowCreditSpentRatio: 'si_low_credit_spent_ratio',
  lowCreditWindowDays: 'si_low_credit_window_days',
  lowCreditMinMemberDays: 'si_low_credit_min_member_days',
  maxCallSeconds: 'si_max_call_seconds',
  textsPerCallMax: 'si_texts_per_call_max',
  wrapUpSeconds: 'si_wrap_up_seconds',
  transcriptRetentionDays: 'si_transcript_retention_days',
  smsAutoRepliesPerNumberDay: 'si_sms_auto_replies_per_number_day',
} as const satisfies Record<keyof VoiceSettings, string>;

export const DEFAULT_VOICE: VoiceSettings = {
  outboundStartHour: 9,
  outboundEndHour: 19,
  outboundWeekdays: [1, 2, 3, 4, 5],
  maxOutboundPerUkDay: 1,
  lowCreditSpentRatio: 0.8,
  lowCreditWindowDays: 7,
  lowCreditMinMemberDays: 3,
  maxCallSeconds: 600,
  textsPerCallMax: 2,
  wrapUpSeconds: 45,
  transcriptRetentionDays: 90,
  smsAutoRepliesPerNumberDay: 3,
};

function numberIn(raw: unknown, min: number, max: number, fallback: number, whole = true): number {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  if (whole && !Number.isInteger(n)) return fallback;
  return n;
}

function weekdays(raw: unknown, fallback: number[]): number[] {
  const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!Array.isArray(arr)) return fallback;
  const days = [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort();
  return days.length > 0 ? days : fallback;
}

export function parseVoice(get: (key: string) => unknown): VoiceSettings {
  const d = DEFAULT_VOICE;
  const k = VOICE_KEYS;
  const start = numberIn(get(k.outboundStartHour), 0, 23, d.outboundStartHour);
  let end = numberIn(get(k.outboundEndHour), 1, 24, d.outboundEndHour);
  if (end <= start) end = Math.max(d.outboundEndHour, start + 1);
  return {
    outboundStartHour: start,
    outboundEndHour: Math.min(24, end),
    outboundWeekdays: weekdays(get(k.outboundWeekdays), d.outboundWeekdays),
    maxOutboundPerUkDay: numberIn(get(k.maxOutboundPerUkDay), 0, 1, d.maxOutboundPerUkDay),
    lowCreditSpentRatio: numberIn(get(k.lowCreditSpentRatio), 0.01, 1, d.lowCreditSpentRatio, false),
    lowCreditWindowDays: numberIn(get(k.lowCreditWindowDays), 1, 90, d.lowCreditWindowDays),
    lowCreditMinMemberDays: numberIn(get(k.lowCreditMinMemberDays), 0, 90, d.lowCreditMinMemberDays),
    maxCallSeconds: numberIn(get(k.maxCallSeconds), 60, 1800, d.maxCallSeconds),
    textsPerCallMax: numberIn(get(k.textsPerCallMax), 0, 2, d.textsPerCallMax),
    wrapUpSeconds: numberIn(get(k.wrapUpSeconds), 0, 300, d.wrapUpSeconds),
    transcriptRetentionDays: numberIn(get(k.transcriptRetentionDays), 1, 3650, d.transcriptRetentionDays),
    smsAutoRepliesPerNumberDay: numberIn(get(k.smsAutoRepliesPerNumberDay), 0, 20, d.smsAutoRepliesPerNumberDay),
  };
}
