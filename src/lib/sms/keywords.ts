/**
 * What an inbound text asks for: stop, start, help, or nothing.
 *
 * The keyword sets are Twilio's own (Advanced Opt-Out's defaults), so what we
 * record and what Twilio enforces never disagree. Stopping errs on the side
 * of the member: STOP, STOPALL, UNSUBSCRIBE or OPT OUT anywhere in the text
 * stops ("Please stop"), and the words with an everyday meaning (CANCEL, END,
 * QUIT, REVOKE) stop when they open the text — "Cancel" does, "I'll cancel
 * the viewing" does not. Starting again needs the keyword on its own.
 *
 * Pure: no network, no database, no server-only.
 */

export type Keyword = 'stop' | 'start' | 'help';

/** Stop wherever they appear as a word. */
const STOP_ANYWHERE: ReadonlySet<string> = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'OPTOUT']);
/** Stop only as the first word: they have everyday meanings too. */
const STOP_FIRST: ReadonlySet<string> = new Set(['CANCEL', 'END', 'QUIT', 'REVOKE']);
const START_WORDS: ReadonlySet<string> = new Set(['START', 'UNSTOP', 'YES']);
const HELP_WORDS: ReadonlySet<string> = new Set(['HELP', 'INFO']);

/** Upper case, letters and single spaces only: "  Stop. " → "STOP". */
function normalise(body: string): string {
  return body
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyKeyword(body: string | null | undefined): Keyword | null {
  const text = normalise(body ?? '');
  if (!text) return null;
  const words = text.split(' ');
  if (words.some((w) => STOP_ANYWHERE.has(w)) || / OPT OUT /.test(` ${text} `)) return 'stop';
  if (STOP_FIRST.has(words[0])) return 'stop';
  if (START_WORDS.has(text)) return 'start';
  if (HELP_WORDS.has(text)) return 'help';
  return null;
}

/**
 * Twilio's Advanced Opt-Out sends OptOutType (STOP | START | HELP) when it
 * has already recognised the keyword and sent its own confirmation. We still
 * record it; we just do not reply a second time.
 */
export function keywordFromOptOutType(value: string | null | undefined): Keyword | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v === 'STOP') return 'stop';
  if (v === 'START') return 'start';
  if (v === 'HELP') return 'help';
  return null;
}
