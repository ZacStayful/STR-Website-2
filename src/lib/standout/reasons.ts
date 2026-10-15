/**
 * Batch 25: every reason a standout decision can carry, in plain words. The
 * codes are what standout_decisions.reason stores; /admin/standout shows the
 * words, and Batch 26's chat answers "why was I called?" / "why wasn't I?"
 * from them. Never a figure, an address or a price: the row holds those.
 *
 * Pure.
 */

export const STANDOUT_REASONS = {
  // Saved
  standout: 'Standout: saved to My deals',
  forced: 'Forced from /admin/standout (thresholds skipped)',
  // Member-level: nothing about any deal reaches this member
  team_member: 'Team member: only the account owner is judged',
  no_primary_profile: 'No primary profile',
  client_profile: 'Primary profile is for a client',
  profile_paused: 'Primary profile is paused',
  awaiting_answers: 'Primary profile is waiting for its answers (Start again)',
  no_deal_types: 'No deal types chosen on the primary profile',
  no_min_profit: 'No real minimum-profit answer: deals reach them through Today instead',
  // Deal-level: judged, not standout
  type_not_chosen: 'A deal type the primary profile does not show',
  no_min_profit_for_type: 'No minimum-profit answer for this deal type',
  must_have_missed: 'Misses a must-have',
  too_few_checks: 'Too few answers checked',
  match_below_floor: 'Match below the standout floor',
  below_reveal_match: 'Match below their signup reveal’s best match',
  profit_unknown: 'Profit could not be worked out',
  profit_short: 'Profit not far enough above their minimum',
  not_new: 'Already shown, saved, answered or opened',
  not_beating_best: 'Does not beat a deal already shown or saved to them',
  daily_limit: 'A better standout was saved for them today',
  gone: 'Off the market when checked',
  // Waiting
  needs_recheck: 'Waiting for a live check of the listing',
  retry_later: 'Could not be checked this pass; tried again on the next',
} as const;

export type StandoutReason = keyof typeof STANDOUT_REASONS;

export function isStandoutReason(v: unknown): v is StandoutReason {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(STANDOUT_REASONS, v);
}

/** The words for a stored reason; an unknown code (a later batch's) reads as itself. */
export function reasonLabel(code: string): string {
  return isStandoutReason(code) ? STANDOUT_REASONS[code] : code.replace(/_/g, ' ');
}

/** Why a standout's call did or didn't happen (standout_decisions.call_status). */
export const CALL_STATUS_LABELS: Record<string, string> = {
  pending: 'Call waiting to be queued',
  waiting_called_today: 'Waiting: already called today',
  queued: 'Call queued',
  ringing: 'Call ringing',
  answered: 'Answered',
  missed: 'Missed (text and email sent)',
  voicemail: 'Voicemail (text and email sent)',
  failed: 'Call failed',
  monthly_limit: 'No call: monthly limit reached',
  calls_off: 'No call: calls are off or no consent',
  no_number: 'No call: no verified mobile',
  not_owner: 'No call: team member',
  management_only: 'No call: management company without deal-finding',
  below_floor: 'No call: credit below the floor (text and email sent)',
  one_call: 'No call: another standout got the call',
  deal_gone: 'No call: the deal went before the call',
  deal_acted: 'No call: they opened it or said Not for me first',
  type_not_chosen: 'No call: they stopped showing this deal type',
  deal_calls_off: 'No call: deal calls switched off',
  profile_changed: 'No call: their main profile changed or was paused',
  waiting_window: 'Waiting for the text window (8am to 8pm)',
  stale: 'No call: waited too long',
  exists: 'No call: already called about this deal',
  error: 'No call: the queue could not be written',
};

export function callStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (status.startsWith('blocked:')) return `Blocked: ${status.slice(8).replace(/_/g, ' ')}`;
  return CALL_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

// ── The member's own words (Review R3, R3-98): what the chat's why_called tool reads ──
// Second person, nothing about the admin page, the team or the thresholds' names. A code with no entry here
// (a later batch's) reads as the admin words, which are plain English too.

export const MEMBER_REASONS: Readonly<Partial<Record<StandoutReason, string>>> = {
  standout: 'A standout: saved to your My deals',
  forced: 'Saved for you by the Stayful team',
  team_member: 'Standouts are judged for the account owner, not for team members',
  no_primary_profile: "You don't have a search profile yet",
  client_profile: "Your main profile is for a client, so standouts aren't judged on it",
  profile_paused: 'Your main profile is paused',
  awaiting_answers: 'Your main profile is waiting for its answers (Start again)',
  no_deal_types: "Your main profile doesn't choose a deal type yet",
  no_min_profit: "You haven't given a real minimum profit, so deals reach you through Today instead",
  type_not_chosen: "A deal type your main profile doesn't show",
  no_min_profit_for_type: "You haven't given a minimum profit for this deal type",
  must_have_missed: 'It misses one of your must-haves',
  too_few_checks: 'Too few of your answers could be checked against it',
  match_below_floor: 'Its match was below the standout floor',
  below_reveal_match: "Its match was below your sign-up reveal's best",
  profit_unknown: "Its profit couldn't be worked out",
  profit_short: 'Its profit was not far enough above your minimum',
  not_new: "You'd already seen, saved, answered or opened it",
  not_beating_best: "It doesn't beat a deal already shown or saved to you",
  daily_limit: 'A better standout was saved for you that day',
  gone: 'It was off the market when checked',
  needs_recheck: 'Waiting for a live check of the listing',
  retry_later: "It couldn't be checked on that pass, so it was tried again on the next",
};

export function memberReasonLabel(code: string): string {
  return (isStandoutReason(code) ? MEMBER_REASONS[code] : undefined) ?? reasonLabel(code);
}

export const MEMBER_CALL_STATUS: Readonly<Record<string, string>> = {
  pending: 'A call is waiting to be queued',
  waiting_called_today: "Waiting: you'd already been called that day",
  queued: 'A call is queued',
  ringing: 'Ringing you',
  answered: 'You answered',
  missed: 'You missed it (a text and an email went out)',
  voicemail: 'It went to voicemail (a text and an email went out)',
  failed: 'The call failed',
  monthly_limit: "No call: this month's deal calls are used up",
  calls_off: 'No call: calls are off, or without your consent',
  no_number: 'No call: no verified mobile on your account',
  not_owner: 'No call: calls go to the account owner, not team members',
  management_only: 'No call: a management-company account without deal-finding',
  below_floor: 'No call: your credit was below the call floor (a text and an email went out)',
  one_call: 'No call: another standout got that call',
  deal_gone: 'No call: the deal went before the call',
  deal_acted: 'No call: you opened it or said Not for me first',
  type_not_chosen: 'No call: you stopped showing this deal type',
  deal_calls_off: 'No call: deal calls are switched off',
  profile_changed: 'No call: your main profile changed or was paused',
  waiting_window: 'Waiting for the text window (8am to 8pm)',
  stale: 'No call: it waited too long',
  exists: "No call: you'd already been called about this deal",
  error: "No call: the queue couldn't be written",
};

export function memberCallStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (status.startsWith('blocked:')) return `Not placed: ${status.slice(8).replace(/_/g, ' ')}`;
  return MEMBER_CALL_STATUS[status] ?? callStatusLabel(status);
}
