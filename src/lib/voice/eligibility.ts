/**
 * Batch 23: may Stayful Intelligence place this outbound call now? One pure
 * rule set for every call type, used when a call is queued and again just
 * before it is dialled. Batch 25's deal calls reuse it unchanged.
 *
 * The shared rules (any outbound call):
 *   calls on, the account owner, a verified number that hasn't sent STOP,
 *   at most si_max_outbound_calls_per_uk_day (1) a member per UK day, one
 *   call in flight, enough credit for a minute, inside outbound hours.
 * The low-credit call adds:
 *   auto top-up off, not in the member's first si_low_credit_min_member_days
 *   days, and not on the UK day of their intro call.
 *
 * Batch 22f: a management company (profiles.signup_path) that has not
 * switched deal-finding on gets neither the intro (it is about searching
 * deals for them) nor the low-credit call (about their daily picks). A skip,
 * not a block: the intro is still owed if they switch deal-finding on.
 *
 * Callbacks never pass through here: they are answered at any time and do
 * not count towards the day.
 *
 * Pure.
 */
import type { BlockedReason, CallType } from './config.ts';
import type { VoiceSettings } from './settings.ts';
import { inOutboundHours } from './hours.ts';

export interface EligibilityInput {
  type: Exclude<CallType, 'callback'>;
  now: Date;
  settings: VoiceSettings;
  callsOn: boolean;
  isOwner: boolean;
  /** A verified mobile that hasn't sent STOP (consent.ts hasVerifiedMobile). */
  numberOk: boolean;
  autoTopupOn: boolean;
  joinedAt: Date;
  /** Outbound calls already placed for this member today (UK day), this one excluded. */
  placedToday: number;
  /** Another outbound call queued or ringing for this member, this one excluded. */
  otherInFlight: boolean;
  /** The member's intro call was placed today (UK day). */
  introToday: boolean;
  /** Whole seconds of calling the member's balance pays for. */
  affordableSeconds: number;
  /** Batch 22f: a management company without deal-finding (src/lib/management/stamp.ts). */
  managementOnly?: boolean;
}

export type Eligibility =
  | { ok: true }
  /** Not now, but later: outside hours, or (the intro only) today's call is used. */
  | { ok: false; defer: 'hours' | 'next_day'; reason?: BlockedReason }
  /** No. `skip` reasons are member choices (no row is written when queueing); the rest are blocked rows. */
  | { ok: false; defer?: undefined; reason: BlockedReason; skip: boolean };

/** Reasons that are the member's own settings, not a safety rule. */
const SKIPS: ReadonlySet<BlockedReason> = new Set(['calls_off', 'not_owner', 'auto_topup_on', 'management_no_deals']);

const DAY_MS = 24 * 60 * 60_000;

export function checkEligibility(i: EligibilityInput): Eligibility {
  const no = (reason: BlockedReason): Eligibility => ({ ok: false, reason, skip: SKIPS.has(reason) });
  if (!i.isOwner) return no('not_owner');
  if (!i.callsOn) return no('calls_off');
  if (i.managementOnly) return no('management_no_deals');
  if (i.type === 'low_credit' && i.autoTopupOn) return no('auto_topup_on');
  if (!i.numberOk) return no('no_number');
  if (i.type === 'low_credit') {
    if (i.now.getTime() - i.joinedAt.getTime() < i.settings.lowCreditMinMemberDays * DAY_MS) return no('first_days');
    if (i.introToday) return no('intro_day');
  }
  if (i.settings.maxOutboundPerUkDay <= 0) return no('daily_limit');
  if (i.placedToday >= i.settings.maxOutboundPerUkDay) {
    // The intro waits for another day; any other call is blocked for good.
    return i.type === 'intro' ? { ok: false, defer: 'next_day', reason: 'daily_limit' } : no('daily_limit');
  }
  if (i.otherInFlight) return i.type === 'intro' ? { ok: false, defer: 'next_day', reason: 'in_flight' } : no('in_flight');
  if (i.affordableSeconds < 60) return no('no_credit');
  if (!inOutboundHours(i.now, i.settings)) return { ok: false, defer: 'hours' };
  return { ok: true };
}
