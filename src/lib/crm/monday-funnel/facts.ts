/**
 * Everything the Monday funnel knows about one member, gathered by
 * ./facts-server.ts from the database, and the few pure derivations the
 * values need (the ad source, Email OK). Pure: no network, no database, no
 * server-only.
 */
import type { AccountStatus } from '../../access.ts';
import { cleanExtras } from '../../activity/event.ts';

export interface MemberFacts {
  userId: string;
  email: string | null;
  name: string | null;
  mobile: string | null;
  /** profiles.mobile_key, else the number normalised as the welcome check does. */
  mobileKey: string | null;
  createdAt: string | null;
  /** profiles.monday_item_id: the row this member was matched to last time. */
  mondayItemId: string | null;

  /** accountStatus() of the member's own profile. */
  planStatus: AccountStatus;
  /** Stripe's status, as stored. */
  subscriptionStatus: string | null;
  planCode: string | null;
  /** A plan set by hand with no tier (plan 'pro', plan_source 'manual', no plan_code): the site cannot tell which. */
  manualNoTier: boolean;
  /** Inside a pause window. */
  paused: boolean;
  /** The booked end of a plan whose cancellation the member booked. */
  cancelAt: string | null;
  /** When the plan ended. */
  endedAt: string | null;
  /** A payment (a top-up, the pack) after the plan ended. */
  paidSinceEnd: boolean;

  /** Every kind of credit, at face value (what the header shows). */
  balancePence: number;
  spendableBasePence: number;
  /** Payments less refunds (Part E). */
  totalPaidPence: number;
  /** Has paid anything, ever (hasEverPaid: a plan, a top-up, the pack). */
  paidEver: boolean;
  monthlyValuePence: number;
  firstPaidAt: string | null;
  /** Paid top-ups, not the pack, not fully refunded. */
  topups: number;
  lastTopupAt: string | null;
  packBoughtAt: string | null;
  hitZeroAt: string | null;

  /** Batch 9's definition: the last UK day with a qualifying action, and the counts since sign-up. */
  lastActiveDay: string | null;
  activeDays: number;
  activeWeeks: number;
  /** Part C: set at 14 quiet days, cleared when they come back. */
  reengageSince: string | null;

  emailOk: boolean;
  smsOk: boolean;
  /** profiles.about_you.nextDeal, when answered. */
  nextDeal: string | null;
  adSource: string;
  /** Joined on or after the starter pack's cutover. */
  packAccount: boolean;
}

/**
 * Email OK (F2): they have an email address and still get the emails a
 * re-engagement message would be: "Daily picks" or "Weekly: deals I missed"
 * is on (profiles.sourcing_alerts, profiles.alert_missed). One-click
 * unsubscribe turns those off, so it unticks too.
 */
export function emailOkFor(p: { email: string | null; sourcing_alerts: boolean | null; alert_missed: boolean | null }): boolean {
  return Boolean(p.email && p.email.includes('@')) && (p.sourcing_alerts === true || p.alert_missed === true);
}

/**
 * One UTM part: split into words at spaces and punctuation ("Leads – Autumn"
 * reads "Leads Autumn"), then kept only when every word passes the activity
 * log's own check, which refuses anything like a link or a postcode (a link's
 * slashes split it, so its domain is still a word of its own and refused).
 */
function cleanPart(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const words = v
    .slice(0, 200)
    .replace(/[^A-Za-z0-9_.:+-]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return null;
  if (!words.every((w) => cleanExtras({ v: w }).v === w)) return null;
  return words.join(' ').slice(0, 80);
}

/** "utm_source / utm_campaign / utm_content" (Batch 19's member_attribution), or "direct / unknown". */
export function adSourceText(a: { utm_source?: string | null; utm_campaign?: string | null; utm_content?: string | null } | null | undefined): string {
  const source = cleanPart(a?.utm_source);
  if (!source) return 'direct / unknown';
  return [source, cleanPart(a?.utm_campaign) ?? '-', cleanPart(a?.utm_content) ?? '-'].join(' / ');
}
