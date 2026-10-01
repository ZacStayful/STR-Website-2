/**
 * Batch 22's code-only numbers: the ones that shape how the reveal and the
 * Stayful Intelligence view behave, not what anything costs. Money and the
 * thresholds admin may want to move are billing_settings rows
 * (src/lib/intelligence/settings.ts).
 *
 * Pure: no network, no database, no server-only.
 */

/** How long the level-up "power-up" plays; the next question never waits for it. */
export const LEVEL_UP_MS = 900;

/** Budget what-ifs: each budget the chosen types use, raised by these shares. */
export const WHAT_IF_BUDGET_STEPS = [0.1, 0.2] as const;
/** Wider-area what-ifs: this many nearest areas, or this many miles more around home. */
export const WHAT_IF_NEARBY_AREAS = 3;
export const WHAT_IF_EXTRA_MILES = 10;
/** Minimum-profit what-if: lowered by this share. */
export const WHAT_IF_MIN_PROFIT_STEP = 0.2;
/** The most variants worked out, and the most shown. */
export const WHAT_IF_MAX_VARIANTS = 6;
export const WHAT_IF_SHOWN = 3;

/** "Analyse all 3" runs this many reports at a time. */
export const ANALYSES_AT_ONCE = 2;

/** The view asks how a running search is getting on this often. */
export const SEARCH_POLL_MS = 4000;
/** One slice of a member search stops starting new steps after this long. */
export const SEARCH_SLICE_MS = 38_000;
/** A running search's lease: a slice that dies is picked up after it. */
export const SEARCH_LEASE_MS = 90_000;

/** A resume-after-payment intent lasts this long. */
export const RESUME_INTENT_MS = 30 * 60_000;

/** Today keeps at most this many cards when a search refresh adds finds. */
export const TODAY_LIST_MAX = 5;
/** The reveal shows the best match and this many alternatives. */
export const REVEAL_ALTERNATIVES = 2;

/** Wording versions, recorded with each call choice and shown answer. */
export const CALL_CONSENT_VERSION = 'si-calls-2026-10';
export const ANSWERS_VERSION = 'si-answers-2026-10';

/** The question chips, in the order they are offered (only those that apply are shown, at most MAX_CHIPS). */
export const CHIP_ORDER = ['credits', 'open_cost', 'pack', 'save', 'how_picked', 'analysis', 'free_delay', 'calls', 'topup', 'no_match'] as const;
export const MAX_CHIPS = 8;
