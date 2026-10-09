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
  calls_disabled: 'No call: deal calls switched off',
  stale: 'No call: waited too long',
  exists: 'No call: already called about this deal',
  error: 'No call: the queue could not be written',
};

export function callStatusLabel(status: string | null): string {
  if (!status) return '—';
  if (status.startsWith('blocked:')) return `Blocked: ${status.slice(8).replace(/_/g, ' ')}`;
  return CALL_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}
