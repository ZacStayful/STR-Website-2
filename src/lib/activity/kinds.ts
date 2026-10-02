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
  // Batch 21 (E6): the Explorer (its search and area pages) and My deals on screen, once a UK day each.
  explorer_view: inApp('Looked at the Market Explorer'),
  my_deals_view: inApp('Looked at My deals'),

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
  // Batch 21 (E18): leaving or removing, and connecting the extension, are the member's doing too.
  team_leave: inApp('Left a team'),
  team_remove: inApp('Removed a team member'),
  extension_connected: inApp('Connected the browser extension'),

  // Batch 21 (E5): Leads (funnel owners). Lead and funnel ids, the action and a stage name only.
  lead_action: inApp('Worked a lead'),
  funnel_edited: inApp('Set up or changed a funnel'),
  api_key_created: inApp('Created an API key'),

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

  // Batch 12: the profile quiz (logged from src/lib/profile/server.ts).
  // Question ids only, never an answer. Batch 21 (E1, Q15): opening the quiz
  // is where every new sign-in is sent, so it is recorded, never weekly
  // active; the first answer is the first thing a member does.
  profile_started: recordOnly('Started the profile quiz'),
  profile_answered: inApp('Answered a profile question'),
  profile_not_sure: inApp('Said "not sure" to a profile question'),
  profile_finish_later: inApp('Left the profile quiz for later'),
  profile_resumed: recordOnly('Came back to the profile quiz'),
  profile_completed: inApp('Completed their profile'),
  profile_viewed: inApp('Viewed their profile'),
  profile_edited: inApp('Changed a profile answer'),
  profile_reminder_collapsed: inApp('Collapsed the profile reminder'),
  profile_reminder_tapped: inApp('Tapped the profile reminder'),
  profile_reminder_shown: recordOnly('Was shown the profile reminder'),
  profile_email_click: recordOnly('Opened their profile from the daily email'),

  // Saved profiles (Batch 13, src/lib/profiles). Ids only in extras, never a profile's name.
  saved_profile_created: inApp('Created a saved profile'),
  saved_profile_renamed: inApp('Renamed a saved profile'),
  saved_profile_switched: inApp('Switched saved profile'),
  saved_profile_paused: inApp('Paused a saved profile'),
  saved_profile_resumed: inApp('Resumed a saved profile'),
  saved_profile_deleted: inApp('Deleted a saved profile'),
  // Batch 22d: "Start again" on the profile (extras: answers, deals_kept, deals_cleared).
  profile_reset: inApp('Started their profile again'),

  // Batch 14: tailoring (src/lib/tailoring). Criterion keys and steps only, never an answer.
  tailoring_mode: inApp('Switched a must-have or nice-to-have'),
  tailoring_widen: inApp('Widened their search from Today'),
  tailoring_widen_shown: recordOnly('Was shown ways to widen their search'),
  tailoring_prompt: inApp('Answered a profile check on Today'),
  tailoring_prompt_shown: recordOnly('Was shown a profile check on Today'),
  leads_upsell_clicked: inApp('Tapped the Leads card on Today'),

  // Batch 17: Project deals (src/lib/project). Deal ids and line keys only, never a figure.
  project_view: inApp('Looked at a Project deal'),
  project_working: inApp('Opened a Project deal’s working'),
  project_line_edit: inApp('Changed a line of a Project deal’s works'),
  project_line_add: inApp('Added a line to a Project deal’s works'),
  project_lock: inApp('Locked their figures for a Project deal'),
  project_unlock: inApp('Unlocked their figures for a Project deal'),

  // Batch 18: feedback and announcements (src/lib/feedback). Ids, the kind of
  // report and counts only: never what a member wrote or the page they were on.
  feedback_opened: inApp('Opened the feedback form'),
  feedback_sent: inApp('Sent a bug report or idea'),
  announcement_shown: recordOnly('Was shown an announcement'),
  announcement_dismissed: inApp('Dismissed an announcement'),
  announcement_clicked: inApp('Opened an announcement'),
  feedback_email_click: recordOnly('Opened their feedback from a status email'),

  // Batch 19: a signed-in member's cookie choice (src/lib/tracking). The
  // choice and where it was made only. Recorded, never weekly active: the
  // proof of consent itself is consent_records.
  cookie_choice: recordOnly('Made a cookie choice'),

  // Batch 20: the starter pack and the low-credit decision (src/lib/starter-pack,
  // src/lib/credit). Buying and choosing count; being shown and "Not now" are
  // recorded only.
  starter_pack: inApp('Bought the starter pack'),
  starter_pack_not_now: recordOnly('Said "not now" to the starter pack'),
  starter_pack_shown: recordOnly('Was shown the starter pack'),
  low_credit_starter: inApp('Chose Starter when credit was low'),
  low_credit_topup: inApp('Chose a top-up when credit was low'),

  // Batch 22: the signup reveal and Stayful Intelligence
  reveal_viewed: inApp('Saw their signup matches'),
  deep_search_run: inApp('Ran a deep search'),

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
  // Batch 21 (E17, E18): a STOP or START by text, and a PDF fetched through the API.
  sms_stop: recordOnly('Texted STOP'),
  sms_start: recordOnly('Texted START'),
  api_pdf: recordOnly('Downloaded a PDF through the API'),
  // Batch 22: opening the Stayful Intelligence view from the header, asking it a question, a what-if preview, the deep-search line shown.
  si_view: recordOnly('Looked at Stayful Intelligence'),
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

/** Who made a subscription change, as billing/subscription-events.ts records it (SubEventSource). */
export type PlanChangeSource = 'self_serve' | 'portal' | 'stripe' | 'manual' | 'backfill';

/**
 * A subscription change (billing/subscription-events.ts kinds) as an
 * activity, or null when it is not something the member did: a plan ending
 * at the end of its term, a failed or recovered payment, or a resume Stripe
 * reports on its own (that may be the pause simply running out). A start is
 * the member's whoever reports it (Stripe is the only place it is seen),
 * unless the plan was granted by hand.
 *
 * Batch 21 (E15, E19, E20): a pause, a resume, a plan change or a
 * cancellation (and its reversal) is the member's only when they made it
 * themselves, in the app (self_serve) or in Stripe's portal; seen from
 * Stripe otherwise it may be the admin's in the dashboard, and the app has
 * already logged its own, so Stripe's copy is not logged twice. The webhook
 * now passes each event's own source (src/lib/stripe/webhook.ts
 * logPlanActivity): a cancellation booked in the portal, which is the
 * member's and which the app never sees, carries a portal source and is
 * kept, while one made in the dashboard — which Stripe reports with no
 * portal feedback, so the webhook labels it 'stripe' — is not.
 */
export function planActivityKind(subscriptionEvent: string, source: PlanChangeSource): ActivityKind | null {
  if (source === 'manual' || source === 'backfill') return null;
  const own = source === 'self_serve' || source === 'portal';
  switch (subscriptionEvent) {
    case 'started':
      return 'plan_start';
    case 'plan_changed':
      return own ? 'plan_change' : null;
    case 'paused':
      return own ? 'plan_pause' : null;
    case 'cancel_scheduled':
      return own ? 'plan_cancel' : null;
    case 'cancel_reverted':
      return own ? 'plan_cancel_undone' : null;
    case 'resumed':
      return own ? 'plan_resume' : null;
    default:
      return null;
  }
}
