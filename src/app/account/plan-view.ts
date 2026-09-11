import type { AccountStatus } from '@/lib/access';
import type { PauseMonths } from '@/lib/subscription';

/**
 * Shared, plain values for the account page.
 *
 * These live here rather than in actions.ts because a 'use server' module may
 * only export functions — anything else is turned into a server reference, so
 * a constant exported from there would not be usable as a value in the client
 * component that imports it.
 */
export type BillingState = { error: string | null; success: string | null };

export const IDLE: BillingState = { error: null, success: null };

/**
 * Why someone is leaving. A fixed list: the slug is stored on the profile for
 * our own reporting, so it must never be free text the client chose.
 */
export const CANCEL_REASONS = [
  { slug: 'too_expensive', label: 'Too expensive' },
  { slug: 'not_using', label: "I'm not using it enough" },
  { slug: 'stopped_looking', label: "I've stopped looking for a property" },
  { slug: 'missing_feature', label: "It's missing something I need" },
  { slug: 'another_tool', label: "I'm using something else" },
  { slug: 'other', label: 'Something else' },
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number]['slug'];


/**
 * Everything the plan card and the cancel dialog need, resolved on the server.
 *
 * Every date is already a formatted string: the dialog runs in the browser,
 * and formatting a date there is how server and client end up disagreeing.
 */
export interface PlanView {
  status: AccountStatus;
  /** Arranged by hand, so there is no Stripe subscription to drive. */
  managedByUs: boolean;
  cancelScheduled: boolean;
  pauseScheduled: boolean;
  renewsOn: string | null;
  endsOn: string | null;
  pausesOn: string | null;
  pausedUntil: string | null;
  /** When a pause booked today would start — the end of the paid period. */
  pauseFrom: string | null;
  pauseChoices: { months: PauseMonths; until: string }[];
  freeReportsLeft: number | null;
  checkoutHref: string;
  contactHref: string;
}
