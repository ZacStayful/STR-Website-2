/**
 * Inactivity (Batch 20, Part C): when a member who has gone quiet moves to
 * Re-engage (billing_settings.inactive_reengage_days, 14) and when their daily
 * picks pause (picks_pause_inactive_days, 25).
 *
 * "Active" is Batch 9's weekly-active definition, reused: a day counts when
 * the member did something in a qualifying kind (src/lib/activity/kinds.ts),
 * on UK days. The days are kept in member_active_days by the nightly.
 *
 * Counted from the latest of: their last active UK day, the day they signed
 * up, and billing_settings.inactivity_from (the release date: nobody is
 * counted as quiet from before the rules existed). While inactivity_from is
 * empty the rules are off.
 *
 * Who can be quiet at all: nobody on a live, trialling, past-due or paused
 * plan, unless they booked its cancellation (counted as cancelled from the
 * booking). A team member follows their owner's plan; their own activity
 * counts. Never an admin or a Stayful (@stayful.co.uk) account.
 *
 * Pure: no network, no database, no server-only.
 */
import type { AccountStatus } from '../access.ts';
import { ukDay } from '../activity/week.ts';
import type { LifecycleSettings } from '../lifecycle/settings.ts';

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
  return !onPlan || input.cancelBooked;
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
