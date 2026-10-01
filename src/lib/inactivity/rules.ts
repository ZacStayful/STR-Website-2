/**
 * Inactivity (Batch 20, Part C): when a member who has gone quiet moves to
 * Re-engage (billing_settings.inactive_reengage_days, 14) and when their daily
 * picks pause (picks_pause_inactive_days, 25).
 *
 * "Active" is Batch 9's weekly-active definition, reused: a day counts when
 * the member did something in a qualifying kind (src/lib/activity/kinds.ts),
 * on UK days. The days are kept in member_active_days by the nightly. So does
 * engaging by email or text (EMAIL_ENGAGEMENT_KINDS, kept in
 * member_engaged_days): Zac's call, so a member who only uses the emails is
 * never paused. Those count here only: weekly active, and Monday's Last
 * active, Active days and Active weeks, stay in-app.
 *
 * Counted from the latest of: their last active UK day, the day they signed
 * up, and billing_settings.inactivity_from (the release date: nobody is
 * counted as quiet from before the rules existed). While inactivity_from is
 * empty the rules are off.
 *
 * Who can be quiet at all: nobody on a live, trialling, past-due or paused
 * plan, a booked cancellation included until the plan actually ends (Batch
 * 21, E24, Q9: they have paid for the term). A team member follows their
 * owner's plan; their own activity counts. Never an admin or a Stayful
 * (@stayful.co.uk) account.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AccountStatus } from '../access.ts';
import { QUALIFYING_KINDS, type ActivityKind } from '../activity/kinds.ts';
import { ukDay } from '../activity/week.ts';
import type { LifecycleSettings } from '../lifecycle/settings.ts';

/**
 * Engaging by email or text: a click from one of our emails or texts to a
 * page (recorded from the signed-in page itself, so a mail scanner opening
 * links is not one), an answer given from an email, a setting changed from
 * one (but never turning one off: an unsubscribe is not engaging, Zac's
 * call). Record-only for weekly active; they keep a member from being quiet.
 */
export const EMAIL_ENGAGEMENT_KINDS: readonly ActivityKind[] = ['email_click', 'sms_click', 'email_feedback', 'email_settings', 'profile_email_click', 'feedback_email_click'];

/**
 * Batch 21 (E7): using the product away from the site. A listing checked in
 * the browser extension or a report run through the API is the member at
 * work; record-only for weekly active, but never quiet.
 */
export const ENGAGED_EXTRA_KINDS: readonly ActivityKind[] = ['extension_check', 'api_report'];

/** Everything that keeps a member from being quiet: the weekly-active kinds, engaging by email or text, and the extension or API. */
export const ENGAGED_KINDS: readonly ActivityKind[] = [...QUALIFYING_KINDS, ...EMAIL_ENGAGEMENT_KINDS, ...ENGAGED_EXTRA_KINDS];

/**
 * Does this action keep a member from being quiet? Every weekly-active kind,
 * and engaging by email or text unless it turned something off (extras.on
 * false: an unsubscribe). The nightly applies the same rule in SQL
 * (lifecycle_active_days_sync).
 */
export function isEngagement(kind: string, extras?: Record<string, unknown> | null): boolean {
  if ((QUALIFYING_KINDS as readonly string[]).includes(kind)) return true;
  if ((ENGAGED_EXTRA_KINDS as readonly string[]).includes(kind)) return true;
  if (!(EMAIL_ENGAGEMENT_KINDS as readonly string[]).includes(kind)) return false;
  return extras?.on !== false;
}

export type InactivitySettings = Pick<LifecycleSettings, 'inactiveReengageDays' | 'picksPauseInactiveDays' | 'inactivityFrom'>;

export function isStaffEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && /@stayful\.co\.uk$/i.test(email.trim());
}

/**
 * Can this member be quiet? `planStatus` is the plan holder's (the owner's for
 * a team member); `cancelBooked` whether that plan's cancellation is booked.
 */
export function inactivityEligible(input: { planStatus: AccountStatus; cancelBooked: boolean; admin: boolean; email: string | null }): boolean {
  if (input.admin || isStaffEmail(input.email)) return false;
  const onPlan = input.planStatus === 'paid' || input.planStatus === 'subscription_trial' || input.planStatus === 'paused';
  // Batch 21 (E24, Q9): a booked cancellation is still a paid plan until it ends (`cancelBooked` is kept for the record).
  return !onPlan;
}

function dayNumber(ymd: string): number {
  return Math.round(Date.parse(`${ymd}T12:00:00Z`) / 86_400_000);
}

function ukDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ukDay(new Date(t)) : null;
}

/**
 * Whole UK days since the member was last counted active (see the header),
 * or null when the rules are off (no inactivity_from).
 */
export function daysQuiet(input: { lastActiveDay: string | null; createdAt: string | null }, s: InactivitySettings, now: Date): number | null {
  const from = ukDayOf(s.inactivityFrom);
  if (!from) return null;
  const anchors = [from, ukDayOf(input.lastActiveDay), ukDayOf(input.createdAt)].filter((d): d is string => Boolean(d));
  const latest = anchors.reduce((a, b) => (a > b ? a : b));
  return Math.max(0, dayNumber(ukDay(now)) - dayNumber(latest));
}

export interface InactivityState {
  reengage: boolean;
  picksPaused: boolean;
  days: number | null;
}

/** Where the member should be tonight. */
export function inactivityState(input: { eligible: boolean; lastActiveDay: string | null; createdAt: string | null }, s: InactivitySettings, now: Date): InactivityState {
  const days = daysQuiet(input, s, now);
  if (!input.eligible || days === null) return { reengage: false, picksPaused: false, days };
  const reengageAt = Math.max(1, s.inactiveReengageDays);
  const pauseAt = Math.max(1, s.picksPauseInactiveDays);
  return { reengage: days >= reengageAt, picksPaused: days >= pauseAt, days };
}

export interface InactivityChange {
  setReengage: boolean;
  clearReengage: boolean;
  setPaused: boolean;
  clearPaused: boolean;
}

/** What to write to bring the stored columns to `target`. Nothing when they already match. */
export function inactivityChange(stored: { reengageSince: string | null; picksPausedAt: string | null }, target: InactivityState): InactivityChange {
  return {
    setReengage: target.reengage && !stored.reengageSince,
    clearReengage: !target.reengage && Boolean(stored.reengageSince),
    setPaused: target.picksPaused && !stored.picksPausedAt,
    clearPaused: !target.picksPaused && Boolean(stored.picksPausedAt),
  };
}
