/**
 * Batch 27: Stayful Intelligence acts for the member. The structural
 * constants: what the eye may do, the words it uses for each thing, and the
 * statuses an instruction and its steps move through. Every number Zac tunes
 * (the £20 cap, the Undo window, the Stop countdown, the rate limits) is a
 * billing_settings row in ./settings.ts; the low-credit line is Batch 20's
 * own low_credit_pence (Zac, 11 Oct: one line, never two).
 *
 * What the eye may do (Zac, 29 Sep, v1): check a pasted link, run full
 * analyses / Deep reports / a deep search, draft an agent message (a read:
 * the member sends it), Keep / Pass / move a deal's stage, and change the
 * active profile's criteria. Nothing else is executable: there is no step
 * kind for paying, topping up, plans, auto top-up, cancelling, deleting,
 * sharing, notifications or contacting anyone outside Stayful, so no text a
 * member or a listing types can make one run.
 *
 * Pure: no network, no database, no server-only.
 */
import type { PipelineStatus } from '../listing/pipeline.ts';

/** Every kind of step the eye can carry out. Anything else a model proposes is dropped. */
export const STEP_KINDS = ['keep', 'pass', 'stage_move', 'full_analysis', 'deep_report', 'deep_search', 'check_link', 'change_criteria'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export function isStepKind(v: unknown): v is StepKind {
  return typeof v === 'string' && (STEP_KINDS as readonly string[]).includes(v);
}

/** Steps that cost credit (each at exactly what its button charges). The rest are free and run at once. */
export const CHARGED_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(['full_analysis', 'deep_report', 'deep_search', 'check_link']);

/** Steps Undo can put back (Zac, 29 Sep: Keep/Pass, stage moves and profile changes). Charges are never undone. */
export const UNDOABLE_KINDS: ReadonlySet<StepKind> = new Set<StepKind>(['keep', 'pass', 'stage_move', 'change_criteria']);

/** The stages a step may name, as My deals stores them ('watching' is Kept). */
export const STEP_STAGES: readonly PipelineStatus[] = ['watching', 'contacted', 'viewing', 'offer', 'secured', 'passed'];

/**
 * The profile answers the eye may change (Batch 12's question ids, saved by
 * answerQuestion), plus two list edits that only ever add (or, when the
 * member says so in plain words, remove) one item.
 */
export const CRITERIA_QUESTIONS = ['bedrooms', 'budget', 'max_rent', 'min_profit', 'r2r_min_profit', 'property_type', 'add_deal_type', 'remove_deal_type', 'add_areas'] as const;
export type CriteriaQuestion = (typeof CRITERIA_QUESTIONS)[number];

export function isCriteriaQuestion(v: unknown): v is CriteriaQuestion {
  return typeof v === 'string' && (CRITERIA_QUESTIONS as readonly string[]).includes(v);
}

/** The Batch 12 question each criteria change is saved through. */
export const CRITERIA_SAVED_AS: Record<CriteriaQuestion, 'bedrooms' | 'budget' | 'max_rent' | 'min_profit' | 'r2r_min_profit' | 'property_type' | 'deal_types' | 'where'> = {
  bedrooms: 'bedrooms',
  budget: 'budget',
  max_rent: 'max_rent',
  min_profit: 'min_profit',
  r2r_min_profit: 'r2r_min_profit',
  property_type: 'property_type',
  add_deal_type: 'deal_types',
  remove_deal_type: 'deal_types',
  add_areas: 'where',
};

/**
 * An instruction (one question in the full view that asked the eye to do
 * something):
 *   proposed          the model's plan, checked and priced; the answer is still being written
 *   cancelled         the answer wasn't delivered (failed its checks, or the page went): nothing ran
 *   done              nothing left to do: the free steps ran, and any charged ones finished, stopped or were declined
 *   ready             charged steps waiting out the Stop countdown
 *   awaiting_confirm  waiting on the member's yes (the balance would drop under the low-credit line, or the rest past £20)
 *   running           charged steps being started, one at a time
 *   stopped           the member tapped Stop
 *   declined          the member said no to a confirm
 *   blocked           not enough credit for the charged steps: nothing charged ran
 *   expired           a countdown or confirm nobody acted on
 */
export const INSTRUCTION_STATUSES = ['proposed', 'cancelled', 'done', 'ready', 'awaiting_confirm', 'running', 'stopped', 'declined', 'blocked', 'expired'] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

/**
 * One step:
 *   queued      waiting its turn
 *   deferred    past the £20 cap: waits for the member's yes
 *   running     claimed by the one process starting it
 *   handed_out  started; its long part runs through the button's own route (a full analysis's run, a PMI opinion)
 *   done        finished (for a charged step: started and charged by its own code, or reused free)
 *   failed      didn't happen; never charged (its own code decides that)
 *   dropped     refused before anything ran (drop_reason says why)
 *   stopped     the member stopped it before it started
 *   declined    the member said no to its confirm
 *   skipped     not run: the balance didn't cover it when its turn came, or the instruction expired
 */
export const STEP_STATUSES = ['queued', 'deferred', 'running', 'handed_out', 'done', 'failed', 'dropped', 'stopped', 'declined', 'skipped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Why a step was dropped before anything ran: each has the words the eye says. */
export const DROP_REASONS = {
  unknown: 'That isn’t something I can do for you.',
  not_seen: 'I couldn’t find that deal among yours.',
  duplicate: 'That was already in the list.',
  needs_open: 'That deal needs opening first, to see the address.',
  already_done: 'That one already has its report.',
  already_there: 'That deal is already at that stage.',
  unsupported_site: 'I can check Rightmove, OnTheMarket and Airbnb links.',
  link_not_given: 'I only check a link you paste into your message.',
  needs_extension: 'Zoopla and Booking.com pages need the browser extension to check.',
  no_link_checks: 'Listing checks aren’t on for your account.',
  bad_value: 'That isn’t a value your profile can take.',
  not_asked_to_remove: 'I only remove a deal type when you ask me to in plain words.',
  not_areas_mode: 'Your profile looks around a postcode, so areas are changed on your profile page.',
  deep_search_off: 'The deep search isn’t available just now.',
  deep_search_running: 'A search is already running for you.',
  too_many: 'That’s more than I do in one go.',
  busy: 'I’m still working on your last instruction: stop it or let it finish first.',
  not_a_deal_kind: 'There is no next step for that kind of deal.',
} as const;
export type DropReason = keyof typeof DROP_REASONS;

/** The agent messages the eye drafts: the next-step slot's own templates (src/lib/pipeline/next-steps.ts). */
export const DRAFT_KINDS = ['enquiry', 'follow_up', 'offer'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** How many full analyses run at once (Part H's "Analyse all" runs two). */
export const ANALYSES_AT_ONCE = 2;

/** A running instruction older than this is closed by the nightly job (its steps' own code settles them). */
export const RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

/** The longest list one propose_actions call may carry before the target cap. */
export const MAX_PROPOSED_STEPS = 60;

/** Activity extras every action carries (keys are the log's snake_case; event.ts drops anything else). */
export const ACTIVITY_BY = 'stayful_intelligence';
