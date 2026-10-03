/**
 * Batch 24: the "no typed figures" check. Every figure in an answer must be a
 * placeholder resolved from settings when it is shown, so the text around
 * the placeholders may hold no digits, currency, percentages, multipliers,
 * links, email addresses or phone numbers. Run on the template with its
 * placeholders removed (template.ts bareText); approval is refused while
 * anything blocking is found. Number words ("five", "twice") are a warning:
 * most are a figure that belongs in a placeholder, a few are just English.
 *
 * Pure: no network, no database, no server-only.
 */

/** Product names that contain a digit and are not figures. */
export const FIGURE_ALLOWLIST: readonly string[] = ["Today's 5", 'Today’s 5', '24/7'];

const BLOCKING: ReadonlyArray<readonly [RegExp, string]> = [
  [/https?:\/\/\S+|www\.\S+/gi, 'a link'],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'an email address'],
  [/[£$€]/g, 'a currency sign'],
  [/%/g, 'a percentage'],
  [/×/g, 'a multiplier'],
  [/\d+(?:[.,:/]\d+)*\s*(?:x|p|k|pm|am|hrs?|mins?)?\b/gi, 'a number'],
];

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|half|quarter|twice|double|triple|dozens?)\b/gi;

export interface FigureCheck {
  /** What must be a placeholder before the entry can be approved. */
  blocking: string[];
  /** Number words worth a second look. */
  warnings: string[];
}

export function figureCheck(bare: string): FigureCheck {
  let text = bare;
  for (const allowed of FIGURE_ALLOWLIST) text = text.split(allowed).join(' ');
  const blocking: string[] = [];
  for (const [re, what] of BLOCKING) {
    for (const m of text.matchAll(re)) {
      blocking.push(`${what}: "${m[0].trim()}"`);
    }
    // Remove what was found so a link's digits are not reported twice.
    text = text.replace(re, ' ');
  }
  // "one" in "anyone"/"someone" is not matched (word boundaries); "one" alone is a soft signal.
  const warnings = [...bare.matchAll(NUMBER_WORDS)].map((m) => `a number word: "${m[0]}"`);
  return { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)] };
}
