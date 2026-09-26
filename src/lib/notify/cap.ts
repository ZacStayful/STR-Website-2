/**
 * The email cap, as rules: which slot each kind of member email takes, which
 * slots a day has, and the keys that make a send impossible to repeat.
 *
 * A member gets at most ONE non-billing email a day and, on Mondays, TWO:
 *
 *   daily   Today's 5, the changes-only email, the picks-paused letter, an
 *           admin notice. Whichever claims the day's slot first is the one
 *           that goes; the others bundle into it or wait for tomorrow.
 *   weekly  Your week, Mondays only.
 *
 * The record behind the rules is notification_sends (supabase/schema.sql);
 * every capped sender claims through ./sends.ts. Billing and receipt emails
 * are never capped and never go through here.
 *
 * Pure, so the rules are tested once.
 */
import { randomBytes } from 'node:crypto';

export type Slot = 'daily' | 'weekly';

export type SendKind = 'todays_5' | 'deal_changes' | 'picks_paused' | 'your_week' | 'notice';

export const SLOT_FOR: Readonly<Record<SendKind, Slot>> = {
  todays_5: 'daily',
  deal_changes: 'daily',
  picks_paused: 'daily',
  notice: 'daily',
  your_week: 'weekly',
};

export function slotFor(kind: SendKind): Slot {
  return SLOT_FOR[kind];
}

/** The day a send counts against: the UTC date, as the picks' "sent today" guard counts it. */
export function capDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Monday by the same UTC day. */
export function isCapMonday(now: Date = new Date()): boolean {
  return now.getUTCDay() === 1;
}

/** Whether this slot exists today: the daily one always, the weekly one on Mondays. */
export function slotAllowed(slot: Slot, now: Date = new Date()): boolean {
  return slot === 'daily' || isCapMonday(now);
}

/** How many capped emails a member may get today. */
export function maxSendsOn(now: Date = new Date()): number {
  return isCapMonday(now) ? 2 : 1;
}

/**
 * Resend's Idempotency-Key for a send: the slot itself. Resend keeps a key
 * for 24 hours and will neither send the same request twice nor accept a
 * different email under the same key, so even a second writer that got past
 * the table could not put a second daily email in the member's inbox.
 */
export function sendKey(slot: Slot, userId: string, day: string, channel = 'email'): string {
  return `${channel}/${slot}/${day}/${userId}`;
}

/** The one-click unsubscribe token a send carries (24 random bytes, base64url, as a pick token). */
export function newSendToken(): string {
  return randomBytes(24).toString('base64url');
}

export const SEND_TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export function isSendToken(v: unknown): v is string {
  return typeof v === 'string' && SEND_TOKEN.test(v);
}

/** A key for an admin test send: never the member's real slot. */
export function testSendKey(nonce: string): string {
  return `test/${nonce}`;
}
