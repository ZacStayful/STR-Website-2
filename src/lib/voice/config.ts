/**
 * Batch 23: Stayful Intelligence calls — the code-only lists and the env
 * readers. Numbers admin may want to move are billing_settings rows
 * (src/lib/voice/settings.ts).
 *
 * Pure apart from reading process.env: no network, no database.
 */

/**
 * The one list of call types. Batch 25 appends 'deal' (and rebuilds the
 * si_calls_log_call_type_check constraint in its schema section).
 */
export const CALL_TYPES = ['intro', 'low_credit', 'callback'] as const;
export type CallType = (typeof CALL_TYPES)[number];

/** The types the system places (callbacks are the member ringing in). */
export const OUTBOUND_CALL_TYPES: readonly CallType[] = ['intro', 'low_credit'];

export const CALL_STATUSES = ['queued', 'ringing', 'answered', 'missed', 'voicemail', 'failed', 'blocked'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Why a call was not placed (written on the blocked row, shown on /admin/calls). */
export const BLOCKED_REASONS = {
  daily_limit: "Already called today (one outbound call a day)",
  first_days: "Joined too recently for a low-credit call",
  intro_day: "Intro call was today",
  in_flight: "Another call is queued or ringing",
  no_number: "No verified number, or the number sent STOP",
  no_credit: "Not enough credit for a minute",
  calls_off: "Calls switched off before the call was placed",
  not_owner: "Team member (calls go to the account owner)",
  auto_topup_on: "Auto top-up already on",
  stale: "Waited too long in the queue",
  // Batch 22f: a management company that has not switched deal-finding on.
  management_no_deals: "Management company without deal-finding",
} as const;
export type BlockedReason = keyof typeof BLOCKED_REASONS;

/** Labels for the member's Calls list and admin. */
export const CALL_TYPE_LABEL: Record<CallType, string> = {
  intro: 'Introduction',
  low_credit: 'Low credit',
  callback: 'You rang me',
};

/** The texts the agent may send during a call: pre-written templates only. */
export const CALL_TEXT_TEMPLATES = ['contact_card', 'auto_topup_link', 'resend_last_link'] as const;
export type CallTextTemplate = (typeof CALL_TEXT_TEMPLATES)[number];

/** The server tools and their per-call limits. */
export const TOOL_LIMITS = {
  lookup_caller: 3,
  send_template_text: 2, // also capped by si_texts_per_call_max
  handoff_to_team: 1,
  log_question: 40,
} as const;
export type ToolName = keyof typeof TOOL_LIMITS;
export const TOOL_NAMES = Object.keys(TOOL_LIMITS) as ToolName[];

export const QUESTION_OUTCOMES = ['answered', 'low_confidence', 'could_not_answer', 'member_unhappy', 'handed_off'] as const;
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[number];

/** A ringing call with no webhook after this long is reconciled from Twilio. */
export const STALE_RINGING_MS = 30 * 60_000;
/** A queued call older than this is dropped (blocked: stale) rather than placed late. */
export const STALE_QUEUED_MS = 4 * 24 * 60 * 60_000;
/** Tool requests are accepted for this long after the call's max duration. */
export const TOOL_GRACE_MS = 5 * 60_000;
/** The unit row every call minute is priced from. */
export const CALL_MINUTE_UNIT = { provider: 'si', unit: 'call_minute' } as const;
/** The action name on the ledger. */
export const CALL_ACTION = 'si_call';

export interface VoiceEnv {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
}

/** ElevenLabs credentials for placing calls; null when any is missing. */
export function voiceConfig(env: Record<string, string | undefined> = process.env): VoiceEnv | null {
  const apiKey = (env.ELEVENLABS_API_KEY ?? '').trim();
  const agentId = (env.ELEVENLABS_AGENT_ID ?? '').trim();
  const phoneNumberId = (env.ELEVENLABS_PHONE_NUMBER_ID ?? '').trim();
  return apiKey && agentId && phoneNumberId ? { apiKey, agentId, phoneNumberId } : null;
}

/** Calls are placed only with SI_CALLS_ENABLED=true (set last, after the manual setup). */
export function callsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SI_CALLS_ENABLED === 'true';
}

/** SI_CALLS_DRY_RUN=true (Preview): everything runs except the call and texts actually going out. */
export function callsDryRun(env: Record<string, string | undefined> = process.env): boolean {
  return env.SI_CALLS_DRY_RUN === 'true';
}

export function webhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  return (env.ELEVENLABS_WEBHOOK_SECRET ?? '').trim() || null;
}
export function initiateSecret(env: Record<string, string | undefined> = process.env): string | null {
  return (env.ELEVENLABS_INITIATE_SECRET ?? '').trim() || null;
}
export function toolSecret(env: Record<string, string | undefined> = process.env): string | null {
  return (env.ELEVENLABS_TOOL_SECRET ?? '').trim() || null;
}
