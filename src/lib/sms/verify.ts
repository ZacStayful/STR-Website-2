/**
 * Verifying a member's mobile: the rules, as plain functions.
 *
 * Our own 6-digit codes rather than Twilio Verify, because the code then
 * comes from the same sender as the alerts: a number that verifies is a
 * number our alerts reach (someone who once replied STOP to us fails here,
 * where they can be told to text START, instead of verifying and silently
 * getting nothing).
 *
 *   a code       6 random digits, stored only as an HMAC of (verification
 *                id, code), valid for 10 minutes, 5 guesses. The guess count
 *                is taken atomically in the database before the compare
 *                (sms_verification_attempt), so parallel guesses cannot beat it.
 *   a resend     60 s apart, at most 3 an hour and 5 a day per member, and
 *                5 a day per number whoever asks.
 *
 * Pure: no network, no database, no server-only.
 */
import { randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_GAP_MS = 60 * 1000;
export const SENDS_PER_HOUR = 3;
export const SENDS_PER_DAY = 5;
export const NUMBER_SENDS_PER_DAY = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Six digits, leading zeros kept. */
export function newCode(random: (max: number) => number = (max) => randomInt(0, max)): string {
  return String(random(1_000_000)).padStart(6, '0');
}

/** What the HMAC covers: binding the code to its verification means a code can never be replayed against another. */
export function codePayload(verificationId: string, code: string): string {
  return `sms-verify:${verificationId}:${code}`;
}

/** The member's typing, as six digits: spaces and dashes forgiven. Null when it cannot be a code. */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Constant-time string equality for stored hashes. */
export function sameHash(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type ResendVerdict = { ok: true } | { ok: false; reason: 'too_soon' | 'hourly_limit' | 'daily_limit' | 'number_limit'; retryAfterSeconds: number };

const t = (d: Date | string | number) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d));

/**
 * Whether another code may be sent now. `userSends` are this member's code
 * texts and `numberSends` every code text to this number (any account), each
 * over at least the last 24 hours.
 */
export function resendVerdict(userSends: readonly (Date | string | number)[], numberSends: readonly (Date | string | number)[], now: Date = new Date()): ResendVerdict {
  const n = now.getTime();
  const mine = userSends.map(t).filter((x) => Number.isFinite(x) && n - x < DAY_MS).sort((a, b) => b - a);
  const theirs = numberSends.map(t).filter((x) => Number.isFinite(x) && n - x < DAY_MS).sort((a, b) => b - a);
  const wait = (until: number) => Math.max(1, Math.ceil((until - n) / 1000));

  if (mine.length > 0 && n - mine[0] < RESEND_GAP_MS) return { ok: false, reason: 'too_soon', retryAfterSeconds: wait(mine[0] + RESEND_GAP_MS) };
  const lastHour = mine.filter((x) => n - x < HOUR_MS);
  if (lastHour.length >= SENDS_PER_HOUR) return { ok: false, reason: 'hourly_limit', retryAfterSeconds: wait(lastHour[SENDS_PER_HOUR - 1] + HOUR_MS) };
  if (mine.length >= SENDS_PER_DAY) return { ok: false, reason: 'daily_limit', retryAfterSeconds: wait(mine[SENDS_PER_DAY - 1] + DAY_MS) };
  if (theirs.length >= NUMBER_SENDS_PER_DAY) return { ok: false, reason: 'number_limit', retryAfterSeconds: wait(theirs[NUMBER_SENDS_PER_DAY - 1] + DAY_MS) };
  return { ok: true };
}

/** What the member is told when a resend is refused. */
export function resendMessage(v: Exclude<ResendVerdict, { ok: true }>): string {
  if (v.reason === 'too_soon') return `Please wait ${v.retryAfterSeconds} seconds before asking for another code.`;
  const minutes = Math.ceil(v.retryAfterSeconds / 60);
  const when = minutes < 90 ? `${minutes} minutes` : `${Math.ceil(minutes / 60)} hours`;
  return `Too many codes asked for. Please try again in ${when}.`;
}

/** Whether a stored verification can still take a guess. */
export function verificationOpen(v: { expires_at: string; attempts: number; verified_at: string | null; superseded_at: string | null }, now: Date = new Date()): boolean {
  return !v.verified_at && !v.superseded_at && v.attempts < MAX_ATTEMPTS && Date.parse(v.expires_at) > now.getTime();
}

/** The code text. Every text we send ends with the opt-out line. */
export function codeText(code: string): string {
  return `Stayful: your code is ${code}. It expires in 10 minutes. Reply STOP to opt out`;
}
