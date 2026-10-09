/**
 * Batch 25, Part C: the slower-spender nudge. A member who took a while to
 * spend their most recent credit — between slower_spender_min_days and
 * _max_days from it landing to the £5 mark (low_credit_pence) — gets one
 * text and email with the one-tap auto top-up link, instead of that
 * landing's £5 notice (Batch 20). The fast spenders (most of their credit
 * gone within a week) are Batch 23's low-credit call; this is everyone else
 * who is still using the site.
 *
 * Due when all of these hold:
 *   balance at or below low_credit_pence
 *   the most recent credit landed (Batch 23's latestLanding) 8–21 days ago
 *   auto top-up off
 *   not quiet (profiles.reengage_since unset: re-engagement has them instead)
 *   no low-credit call placed for this landing
 *   no nudge for this landing yet
 *   something can reach them: texts on, or credit emails on
 *
 * Pure.
 */
import type { Landing } from '../voice/low-credit.ts';

const DAY_MS = 24 * 60 * 60_000;

export interface NudgeInput {
  balancePence: number;
  lowCreditPence: number;
  landing: Landing | null;
  now: Date;
  minDays: number;
  maxDays: number;
  autoTopupOn: boolean;
  reengageSince: string | null;
  /** A Batch 23 low-credit call rang (or is ringing) for this landing. */
  lowCreditCallPlaced: boolean;
  /** A nudge was already decided for this landing. */
  nudgedThisLanding: boolean;
  /** Verified mobile, texts on, no STOP. */
  canText: boolean;
  /** An email, and credit emails on. */
  canEmail: boolean;
  /** Admin accounts are never nudged. */
  admin?: boolean;
}

export type NudgeVerdict =
  | { due: true; daysToLow: number }
  | { due: false; reason: 'admin' | 'not_low' | 'no_landing' | 'too_soon' | 'too_late' | 'auto_topup_on' | 'quiet' | 'low_credit_call' | 'already' | 'unreachable' };

/** Whole days from the credit landing to now. */
export function daysSince(landedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - landedAt.getTime()) / DAY_MS);
}

export function nudgeDue(i: NudgeInput): NudgeVerdict {
  if (i.admin) return { due: false, reason: 'admin' };
  if (!(i.lowCreditPence > 0) || i.balancePence > i.lowCreditPence) return { due: false, reason: 'not_low' };
  if (!i.landing) return { due: false, reason: 'no_landing' };
  const days = daysSince(i.landing.landedAt, i.now);
  if (days < i.minDays) return { due: false, reason: 'too_soon' };
  if (days > i.maxDays) return { due: false, reason: 'too_late' };
  if (i.autoTopupOn) return { due: false, reason: 'auto_topup_on' };
  if (i.reengageSince) return { due: false, reason: 'quiet' };
  if (i.lowCreditCallPlaced) return { due: false, reason: 'low_credit_call' };
  if (i.nudgedThisLanding) return { due: false, reason: 'already' };
  if (!i.canText && !i.canEmail) return { due: false, reason: 'unreachable' };
  return { due: true, daysToLow: days };
}
