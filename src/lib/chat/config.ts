/**
 * Batch 26: the typed chat's structural constants. Business numbers Zac tunes
 * (prices, ceilings, limits) are billing_settings rows in ./settings.ts;
 * everything here is how the chat is built. A model change needs its
 * unit_costs rows too (src/lib/credit/costs.ts), so the models live here, not
 * in a setting.
 *
 * Pure: no network, no database, no server-only.
 */

export type ChatSurface = 'quick' | 'full';

/** Quick answers: knowledge only, one short reply (Zac's decision, 29 Sep). */
export const QUICK_MODEL = 'claude-haiku-4-5-20251001';
/** The full view: knowledge plus the read-only tools. */
export const FULL_MODEL = 'claude-sonnet-5-5';

export interface ModelUnits {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

/** The unit_costs rows each model is metered at (provider 'anthropic'; src/lib/credit/costs.ts). */
export const MODEL_UNITS: Record<ChatSurface, ModelUnits> = {
  quick: { input: 'haiku45_input_token', output: 'haiku45_output_token', cacheRead: 'haiku45_cache_read_token', cacheWrite: 'haiku45_cache_write_token' },
  full: { input: 'sonnet55_input_token', output: 'sonnet55_output_token', cacheRead: 'sonnet55_cache_read_token', cacheWrite: 'sonnet55_cache_write_token' },
};

export const MODEL_FOR: Record<ChatSurface, string> = { quick: QUICK_MODEL, full: FULL_MODEL };

/** The ledger action (and usage label) of a charged question; house spend runs under UNBILLED_ACTION. */
export const CHAT_ACTION: Record<ChatSurface, 'si_chat_quick' | 'si_chat_full'> = { quick: 'si_chat_quick', full: 'si_chat_full' };
export const UNBILLED_ACTION = 'si_chat_unbilled';

/** What every charged line in the ledger says. */
export const CHARGE_DESCRIPTION = 'Stayful Intelligence question';

/** The longest question: the conversation log keeps up to 500 characters. */
export const MAX_QUESTION_CHARS = 500;

/** A turn still pending after this is from an instance that died: marked failed on the member's next question. */
export const PENDING_STALE_MS = 2 * 60_000;

/** One model call's time limit (the SDK is told; no retries, so a retry can never be a second, unseen cost). */
export const QUICK_TIMEOUT_MS = 20_000;
export const FULL_ROUND_TIMEOUT_MS = 40_000;

/**
 * The full view's clock (the route has maxDuration 60): no more look-ups
 * after FULL_LOOKUP_DEADLINE_MS, and no round started that couldn't finish
 * by FULL_HARD_DEADLINE_MS (each round's own timeout is what is left).
 */
export const FULL_LOOKUP_DEADLINE_MS = 35_000;
export const FULL_HARD_DEADLINE_MS = 52_000;
export const MIN_ROUND_TIME_MS = 6_000;
/** A round that may look something up writes at most this (a look-up call, or a short answer). */
export const LOOKUP_ROUND_MAX_TOKENS = 600;

/** The most a full-view round may write before the budget lowers it (the answer itself is ~fullMaxWords). */
export const FULL_ROUND_MAX_TOKENS = 1_200;
/** A round that cannot afford this many output tokens is not started: the answer ends there. */
export const MIN_ROUND_OUTPUT_TOKENS = 120;

/** A tool result is cut to this many characters before the model sees it. */
export const MAX_TOOL_RESULT_CHARS = 6_000;
/** The most deals a list tool returns. */
export const MAX_LIST_DEALS = 15;

/** Characters per token when estimating a prompt before it is sent (generous, like src/lib/credit/meter.ts). */
export const CHARS_PER_TOKEN = 3.5;

/** The exact words the chat uses when it has no approved answer (Zac's brief). */
export const DONT_KNOW_LINE = "I don't know that one yet — I've passed it to the team.";
/** When the quick box needs the member's deals or the engine. */
export const FULL_VIEW_LINE = 'That needs a proper look at your account.';
/** When the balance is below the floor. */
export const TOP_UP_LINE = 'Top up to ask me more.';
/** A team member's version: the owner tops up. */
export const TEAM_TOP_UP_LINE = 'Your team is out of credit for questions. Ask your team owner to top up.';
/** A paused seat. */
export const SEAT_PAUSED_LINE = 'Your seat is paused, so I can’t answer questions just now. Ask your team owner.';
/** Said when the ceiling cut an answer short. */
export const CAPPED_LINE = 'I’ve stopped there to keep this question under its limit.';
/** The member asked too many questions it couldn't answer today. */
export const UNCHARGED_CAP_LINE = 'I’ve had a lot of questions I couldn’t answer today. Try me again tomorrow.';
/** Too fast. */
export const TOO_FAST_LINE = 'One moment — ask again in a few seconds.';
/** A send that failed part-way: nothing was charged. */
export const DID_NOT_FINISH_LINE = 'That answer didn’t finish, so you weren’t charged. Ask again.';
/** The question used its whole hold (or its time) on look-ups before it could answer. */
export const OUT_OF_ROOM_LINE = 'I ran out of room on that one before I could answer, so you weren’t charged. Try a narrower question.';
/** Something went wrong before an answer. */
export const FAILED_LINE = 'Something went wrong, so you weren’t charged. Ask again in a moment.';

/**
 * Batch 26b: the microphone. One spoken question is at most VOICE_MAX_SECONDS
 * (the page stops recording there) and VOICE_MAX_BYTES; ElevenLabs Scribe
 * turns it into text, in British English.
 */
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_BYTES = 3_000_000;
export const STT_MODEL = 'scribe_v2';
export const STT_LANGUAGE = 'en';
export const STT_TIMEOUT_MS = 15_000;

/** Batch 26b: one-tap questions in an empty quick box (each is an ordinary quick question, about 1p). */
export const QUICK_SUGGESTIONS = ['How much credit have I got?', 'How much is a full analysis?', 'How do my daily picks work?'] as const;

/** The two suggestions shown in an empty full view beside Batch 22's chips (Zac's default). */
export const FULL_SUGGESTIONS = ["Why can't you find me anything?", 'What should I look at today?'] as const;
