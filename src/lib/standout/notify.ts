/**
 * Batch 25: how a member hears about the standouts saved for them. One plan
 * per member per pass, for the saves nobody has been told about yet:
 *
 *   the deal has gone                  → nothing (it's no longer worth a word)
 *   saved too long ago to ring about   → "Saved for you" in the daily email
 *   the best one (match, then profit):
 *     deal calls off, or the member can't be called (calls off, no
 *     verified mobile, a team member, a management company without
 *     deal-finding)                    → "Saved for you"
 *     a deal call already queued       → it rings about this one instead if
 *                                        this one is better; else "Saved for you"
 *     standout_calls_per_month placed  → "Saved for you"
 *     credit below the call floor      → a text (texts on) and an email with
 *                                        the link and "top up to get calls",
 *                                        in the text window (08:00–20:00)
 *     otherwise                        → a deal call (Batch 23's queue; it
 *                                        waits for the next weekday when
 *                                        today's call is used)
 *   every other one                    → "Saved for you"
 *
 * Pure.
 */
import { bestFirst } from './rules.ts';

export interface NotifyCandidate {
  decisionId: string;
  matchPct: number | null;
  profitLow: number | null;
  savedAt: string;
  dealLive: boolean;
}

export interface NotifyMember {
  isOwner: boolean;
  callsOn: boolean;
  numberOk: boolean;
  managementOnly: boolean;
  balancePence: number;
}

export interface QueuedDealCall {
  callId: string;
  decisionId: string | null;
  matchPct: number | null;
  profitLow: number | null;
}

export type NotifyStep =
  | { decisionId: string; action: 'call' }
  | { decisionId: string; action: 'retarget'; callId: string; replaces: string | null }
  | { decisionId: string; action: 'below_floor' }
  | { decisionId: string; action: 'email'; status: string }
  | { decisionId: string; action: 'none'; status: string }
  | { decisionId: string; action: 'wait'; status: string };

export interface NotifyPlanInput {
  candidates: readonly NotifyCandidate[];
  /** STANDOUT_CALLS_ENABLED and Batch 23's SI_CALLS_ENABLED. */
  callsSwitchedOn: boolean;
  member: NotifyMember | null;
  /** Deal calls placed this UK month. */
  placedThisMonth: number;
  callsPerMonth: number;
  /** The higher of standout_call_min_balance_pence and Batch 23's own check (a minute's calling and the texts kept back). */
  floorPence: number;
  queued: QueuedDealCall | null;
  /** Inside the text window now. */
  textWindow: boolean;
  now: Date;
  /** A save older than this is not rung about (it goes in "Saved for you"). */
  maxAgeMs: number;
}

/** Whether `a` is a better deal to ring about than `b` (match, then profit). */
export function better(a: { matchPct: number | null; profitLow: number | null }, b: { matchPct: number | null; profitLow: number | null }): boolean {
  const am = a.matchPct ?? -1;
  const bm = b.matchPct ?? -1;
  if (am !== bm) return am > bm;
  return (a.profitLow ?? -Infinity) > (b.profitLow ?? -Infinity);
}

/** Why a member can't be rung at all, or null. */
export function cannotCall(switchedOn: boolean, m: NotifyMember | null): string | null {
  if (!switchedOn) return 'deal_calls_off';
  if (!m) return 'calls_off';
  if (!m.isOwner) return 'not_owner';
  if (!m.callsOn) return 'calls_off';
  if (m.managementOnly) return 'management_only';
  if (!m.numberOk) return 'no_number';
  return null;
}

export function planMember(i: NotifyPlanInput): NotifyStep[] {
  const steps: NotifyStep[] = [];
  const fresh: NotifyCandidate[] = [];
  for (const c of i.candidates) {
    if (!c.dealLive) steps.push({ decisionId: c.decisionId, action: 'none', status: 'deal_gone' });
    else if (i.now.getTime() - Date.parse(c.savedAt) > i.maxAgeMs) steps.push({ decisionId: c.decisionId, action: 'email', status: 'stale' });
    else fresh.push(c);
  }
  if (fresh.length === 0) return steps;
  // R3-20: the member unreadable is not a choice of theirs: everything waits for the next pass.
  if (i.member === null) {
    for (const c of fresh) steps.push({ decisionId: c.decisionId, action: 'wait', status: 'pending' });
    return steps;
  }
  const [best, ...rest] = bestFirst(fresh);
  for (const c of rest) steps.push({ decisionId: c.decisionId, action: 'email', status: 'one_call' });

  const no = cannotCall(i.callsSwitchedOn, i.member);
  if (no) {
    steps.push({ decisionId: best.decisionId, action: 'email', status: no });
    return steps;
  }
  if (i.queued) {
    steps.push(better(best, i.queued) ? { decisionId: best.decisionId, action: 'retarget', callId: i.queued.callId, replaces: i.queued.decisionId } : { decisionId: best.decisionId, action: 'email', status: 'one_call' });
    return steps;
  }
  if (i.placedThisMonth >= i.callsPerMonth) {
    steps.push({ decisionId: best.decisionId, action: 'email', status: 'monthly_limit' });
    return steps;
  }
  if ((i.member?.balancePence ?? 0) < i.floorPence) {
    steps.push(i.textWindow ? { decisionId: best.decisionId, action: 'below_floor' } : { decisionId: best.decisionId, action: 'wait', status: 'waiting_window' });
    return steps;
  }
  steps.push({ decisionId: best.decisionId, action: 'call' });
  return steps;
}

/**
 * What a below-floor member is sent, from their balance (Zac: email only,
 * uncharged, when the balance can't cover it). R3-114: decided per channel in
 * order: the text when texts are on and the balance covers it, then the email
 * charged when what is left covers it, free otherwise. The same balance pays
 * the same whatever the Texts switch says about the email.
 */
export function belowFloorChannels(i: { textsOn: boolean; balancePence: number; textPence: number; emailPence: number }): { text: boolean; chargeEmail: boolean } {
  const text = i.textsOn && i.balancePence >= i.textPence;
  const chargeEmail = i.balancePence - (text ? i.textPence : 0) >= i.emailPence;
  return { text, chargeEmail };
}

/** The deal-call floor: the setting, or Batch 23's own check if that is higher (a minute's calling plus the texts kept back). */
export function callFloorPence(settingPence: number, perMinutePence: number, reservePence: number): number {
  return Math.max(settingPence, Math.ceil(perMinutePence) + reservePence);
}

/** What a deal call's status in si_calls_log means for its decision. */
export type CallSync =
  | { callStatus: string; notify: 'call'; activity?: 'si_deal_call' | 'si_deal_call_missed' }
  /** Not rung, and nothing more to say (the deal went, or they got there first). */
  | { callStatus: string; notify: 'none' }
  /** Not rung: decide again (the next plan tells them another way). */
  | { callStatus: string; notify: null };

/** Block reasons after which the member is told nothing more. */
const NOTHING_MORE: ReadonlySet<string> = new Set(['deal_gone', 'deal_acted', 'type_not_chosen', 'profile_changed', 'quiet']);

export function syncFromCall(call: { status: string; blocked_reason: string | null } | null): CallSync | null {
  if (!call) return { callStatus: 'error', notify: null };
  switch (call.status) {
    case 'queued':
      return null;
    case 'ringing':
      return { callStatus: 'ringing', notify: 'call' };
    case 'answered':
      return { callStatus: 'answered', notify: 'call', activity: 'si_deal_call' };
    case 'missed':
    case 'voicemail':
      return { callStatus: call.status, notify: 'call', activity: 'si_deal_call_missed' };
    case 'failed':
      return { callStatus: 'failed', notify: null };
    case 'blocked': {
      const reason = call.blocked_reason ?? 'blocked';
      return NOTHING_MORE.has(reason) ? { callStatus: reason, notify: 'none' } : { callStatus: `blocked:${reason}`, notify: null };
    }
    default:
      return null;
  }
}
