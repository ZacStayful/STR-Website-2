/**
 * Which funnel group a member belongs in, and their Billing status: one
 * function each, in the order they are checked (Batch 20, Part F; the table
 * is in the plan and in README section 16). Pure.
 *
 *   1  their row is in Excluded              untouched (the caller's rule)
 *   2  a plan set by hand with no tier       group untouched
 *   3  subscription past due or unpaid       Payment issues
 *   4  inside a pause window                 Paused plan
 *   5  live plan, no cancellation booked     5. Starter / 6. Pro (and annual) / 7. Scale
 *   6  Re-engage (14 quiet days)             Re-engage
 *   7  cancellation booked, or the plan
 *      ended with no payment since           Cancelled
 *   8  no plan, £5 or less, and they have
 *      paid something or joined before the
 *      starter pack                          3. Low credit – decision
 *   9  no plan, a paid top-up (not the pack) 4. Pay as you go
 *  10  bought the pack                       2. £10 starter pack
 *  11  everyone else                         1. Free sign-up
 *
 * Row 8's last condition keeps every new £0 sign-up out of Low credit.
 */
import type { FunnelGroup } from './config.ts';
import type { MemberFacts } from './facts.ts';

const LIVE = new Set(['paid', 'subscription_trial']);

/** The plan's tier on the board, or null when the code is not one the board has a group for. */
export function planTier(planCode: string | null): 'starter' | 'pro' | 'scale' | null {
  if (planCode === 'starter') return 'starter';
  if (planCode === 'pro' || planCode === 'pro_annual') return 'pro';
  if (planCode === 'scale') return 'scale';
  return null;
}

/** A live plan whose cancellation is not booked. */
function liveUncancelled(f: MemberFacts): boolean {
  return LIVE.has(f.planStatus) && !f.cancelAt;
}

/** Cancelled: the member booked the cancellation (counted from the booking), or the plan ended and nothing was paid since. */
export function isCancelled(f: MemberFacts): boolean {
  if (LIVE.has(f.planStatus) && f.cancelAt) return true;
  const ended = f.planStatus === 'lapsed' || Boolean(f.endedAt);
  return ended && !LIVE.has(f.planStatus) && !f.paidSinceEnd;
}

function noPlan(f: MemberFacts): boolean {
  return f.planStatus === 'free' || f.planStatus === 'lapsed';
}

/** Row 8: no plan, £5 or less, and they have paid something or joined before the starter pack. */
function lowCredit(f: MemberFacts, lowCreditPence: number): boolean {
  return noPlan(f) && f.balancePence <= lowCreditPence && (f.paidEver || !f.packAccount);
}

/** The group a member belongs in, or 'untouched' for a plan set by hand with no tier (and a live plan the board has no group for). */
export function funnelGroup(f: MemberFacts, lowCreditPence: number): FunnelGroup | 'untouched' {
  if (f.manualNoTier) return 'untouched';
  const status = (f.subscriptionStatus ?? '').toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return 'paymentIssues';
  if (f.paused || f.planStatus === 'paused') return 'paused';
  if (liveUncancelled(f)) return planTier(f.planCode) ?? 'untouched';
  if (f.reengageSince) return 'reengage';
  if (isCancelled(f)) return 'cancelled';
  if (lowCredit(f, lowCreditPence)) return 'lowCredit';
  if (noPlan(f) && f.topups > 0) return 'payg';
  if (f.packBoughtAt) return 'pack';
  return 'free';
}

/**
 * Billing status (F7): "Past due", "Paused", "Cancelling", "Cancelled",
 * "Hit zero" (ran out, profiles.hit_zero_at, and still out), "Low credit"
 * (row 8's rule) or blank, the first that is true.
 */
export function billingStatus(f: MemberFacts, lowCreditPence: number): string {
  const status = (f.subscriptionStatus ?? '').toLowerCase();
  if (status === 'past_due' || status === 'unpaid') return 'Past due';
  if (f.paused || f.planStatus === 'paused') return 'Paused';
  if (LIVE.has(f.planStatus) && f.cancelAt) return 'Cancelling';
  if (isCancelled(f)) return 'Cancelled';
  if (f.hitZeroAt && f.spendableBasePence <= 0.5) return 'Hit zero';
  if (lowCredit(f, lowCreditPence)) return 'Low credit';
  return '';
}
