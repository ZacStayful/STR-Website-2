/**
 * Review R3b: the rules of the chat's voice, pure so the pages, the two
 * voice routes and the knowledge placeholders all read the same ones.
 *
 *   - What a spoken answer costs is the elevenlabs:character row × its
 *     markup × the answer's length (the sum /api/speak meters), quoted
 *     "about" from the surface's word cap.
 *   - After a spoken answer the page listens again by itself at most
 *     VOICE_FOLLOW_ONS_MAX times per tap of the microphone, so a radio in
 *     the room can never run up a chain of paid questions (R3-9).
 *   - Listening is charged for the seconds the transcriber heard, never
 *     more than the page declared (R3-69).
 */

/** A quick answer is clamped to this many words (quick-server.ts). */
export const QUICK_MAX_WORDS = 60;

/** Characters a spoken word takes, the space included: what "about" means in a voice price. */
export const CHARS_PER_WORD = 5.5;

/** Automatic follow-ons after a spoken answer, per tap: it listens once more, then waits for a tap. */
export const VOICE_FOLLOW_ONS_MAX = 1;

/** Roughly how many characters an answer of `words` words is spoken as. */
export function speakCharsFor(words: number): number {
  return Number.isFinite(words) && words > 0 ? Math.round(words * CHARS_PER_WORD) : 0;
}

/**
 * The base price of saying `chars` characters out loud: the
 * elevenlabs:character row × its markup, the sum /api/speak meters. Null
 * when the row is missing or not a price (the answer is then not quoted).
 */
export function speakPricePence(row: { unitCostPence: number; markup: number } | null | undefined, chars: number): number | null {
  if (!row || !(row.unitCostPence > 0) || !(row.markup > 0) || !(chars > 0)) return null;
  return Math.round(row.unitCostPence * row.markup * chars * 10_000) / 10_000;
}

/** May the page listen again by itself after a spoken answer, having done so `followOnsSoFar` times since the tap? */
export function followOnAllowed(followOnsSoFar: number, max = VOICE_FOLLOW_ONS_MAX): boolean {
  return Number.isFinite(followOnsSoFar) && followOnsSoFar >= 0 && followOnsSoFar < max;
}

/**
 * Seconds to charge for a recording: the seconds the transcriber heard
 * (the last word's end), never more than the page declared, at least one,
 * at most the cap. Without a heard length, the declared length.
 */
export function listenSeconds(input: { declared: number; heard: number | null; max: number }): number {
  const declared = Number.isFinite(input.declared) && input.declared > 0 ? input.declared : input.max;
  const bound = Math.min(input.max, Math.max(1, Math.ceil(declared)));
  if (input.heard === null || !Number.isFinite(input.heard) || input.heard <= 0) return bound;
  return Math.min(bound, Math.max(1, Math.ceil(input.heard)));
}
