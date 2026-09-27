/**
 * Every kind of activity the log records, and what each one counts for.
 *
 *   qualifying  counts towards weekly active: something a signed-in member
 *               did in the app. An email or text click, an answer given on
 *               the public pick page, or anything the system did on the
 *               member's behalf does not.
 *   counted     counts as an action: actions per visit, and the actions
 *               column of the drill-down on /admin/weekly-active.
 *
 * Adding a kind is one line here. The database does not check kinds, so no
 * schema change is needed. A kind that is not here cannot be logged: the
 * type refuses it, and so does the check in event.ts.
 *
 * Pure: no network, no database, no server-only.
 */

export interface KindInfo {
  qualifying: boolean;
  counted: boolean;
  /** What the member did, for the admin drill-down. */
  label: string;
}

const inApp = (label: string): KindInfo => ({ qualifying: true, counted: true, label });
const recordOnly = (label: string): KindInfo => ({ qualifying: false, counted: false, label });

export const ACTIVITY_KINDS = {
  // Looking
  today_view: inApp('Viewed Today'),
  deal_view: inApp('Looked at a deal'),
  report_view: inApp('Opened a saved report'),

  // Deals
  keep: inApp('Kept a deal'),
  pass: inApp('Passed on a deal'),
  reaction_clear: inApp('Took back a Keep or Pass'),
  pass_reasons: inApp('Said why they passed'),
  deal_open: inApp('Opened a deal'),
  deal_share: inApp('Shared a deal'),
  stage_move: inApp('Moved a deal to a new stage'),
  next_step: inApp('Used a next-step tool'),

  // Reports and listings
  report_run: inApp('Ran a report'),
  report_deleted: inApp('Deleted a report'),
  pdf_download: inApp('Downloaded a PDF'),
  listing_check: inApp('Checked a listing link'),
  quick_estimate: inApp('Ran a quick estimate'),
  listing_notes: inApp('Wrote notes on a listing'),
  listing_removed: inApp('Removed a listing'),
  listing_share: inApp('Shared a listing'),

  // Areas, goals and picks
  area_saved: inApp('Starred an area'),
  area_removed: inApp('Unstarred an area'),
  goals_saved: inApp('Saved their goals'),
  goals_cleared: inApp('Cleared their goals'),
  welcome_completed: inApp('Answered the welcome questions'),
  pick_feedback: inApp('Answered a daily pick'),
  pick_saved: inApp('Saved a daily pick to My deals'),
  management_enquiry: inApp('Asked about management'),

  // Account
  notification_settings: inApp('Changed a notification setting'),
  sms_verified: inApp('Verified a mobile for texts'),
  team_invite: inApp('Invited a team member'),
  team_join: inApp('Joined a team'),

  // Money
  topup: inApp('Topped up'),
  auto_topup_settings: inApp('Changed auto top-up'),
  credit_code_redeemed: inApp('Redeemed a credit code'),
  plan_start: inApp('Started a plan'),
  plan_change: inApp('Changed plan'),
  plan_pause: inApp('Paused their plan'),
  plan_resume: inApp('Resumed their plan'),
  plan_cancel: inApp('Cancelled their plan'),
  plan_cancel_undone: inApp('Kept their plan after cancelling'),

  // Batch 10 (registered here so it never has to edit this folder)
  full_analysis: inApp('Bought a full analysis'),
  pmi_addon: inApp('Added PMI data'),
  reminder_acted: inApp('Acted on a reminder'),
  reminder_shown: recordOnly('Was shown a reminder'),

  // Recorded, but not the member doing something in the app
  email_click: recordOnly('Came in from an email'),
  sms_click: recordOnly('Came in from a text'),
  email_feedback: recordOnly('Answered a pick from the email'),
  email_settings: recordOnly('Changed a setting from an email'),
  checklist_step: recordOnly('Completed a first-week step'),
  auto_topup: recordOnly('Was topped up automatically'),
  topup_unknown: recordOnly('Topped up (before tracking)'),
  welcome_skipped: recordOnly('Skipped the welcome questions'),
  extension_check: recordOnly('Checked a listing in the browser extension'),
  api_report: recordOnly('Ran a report through the API'),
} as const satisfies Record<string, KindInfo>;

export type ActivityKind = keyof typeof ACTIVITY_KINDS;

const KIND_SET: ReadonlySet<string> = new Set(Object.keys(ACTIVITY_KINDS));

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === 'string' && KIND_SET.has(v);
}

/** Kinds that count towards weekly active. */
export const QUALIFYING_KINDS: readonly ActivityKind[] = (Object.keys(ACTIVITY_KINDS) as ActivityKind[]).filter((k) => ACTIVITY_KINDS[k].qualifying);

/** Kinds that count as an action. */
export const COUNTED_KINDS: readonly ActivityKind[] = (Object.keys(ACTIVITY_KINDS) as ActivityKind[]).filter((k) => ACTIVITY_KINDS[k].counted);

export function isQualifying(kind: string): boolean {
  return isActivityKind(kind) && ACTIVITY_KINDS[kind].qualifying;
}

export function isCounted(kind: string): boolean {
  return isActivityKind(kind) && ACTIVITY_KINDS[kind].counted;
}

/** "Kept a deal"; an unknown kind (an old row, a later batch's) reads as itself. */
export function kindLabel(kind: string): string {
  return isActivityKind(kind) ? ACTIVITY_KINDS[kind].label : kind.replace(/_/g, ' ');
}
