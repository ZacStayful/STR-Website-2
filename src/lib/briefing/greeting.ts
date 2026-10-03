/**
 * Batch 23b: the briefing's greeting, written by code (never the AI):
 * "Hi", "Hello" or "Good morning", then the first name, rotating day by day
 * so the same word never opens two mornings running. With no usable first
 * name, the greeting alone.
 *
 * Pure: no network, no database, no server-only.
 */

export const GREETINGS = ['Hi', 'Hello', 'Good morning'] as const;
export type GreetingWord = (typeof GREETINGS)[number];

/**
 * A first name fit to greet someone by: the first word of full_name, letters
 * (and a hyphen or apostrophe) only, longer than one letter; capitalised.
 * An email address, a number or an initial gives null.
 */
export function usableFirstName(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  if (first.length < 2 || first.length > 30) return null;
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*$/.test(first)) return null;
  // "SARAH" reads as shouting: an all-capitals name of four letters or more is title-cased.
  const name = first.length >= 4 && first === first.toUpperCase() ? first.toLowerCase() : first;
  return name[0].toUpperCase() + name.slice(1);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Days since 1970 for a YYYY-MM-DD. */
function dayNumber(ukDay: string): number {
  return Math.floor(Date.parse(`${ukDay}T12:00:00Z`) / 86_400_000);
}

/**
 * The greeting word for a member on a day: the day number plus a per-member
 * offset, so consecutive days always differ. Outside the morning (`morning`
 * false: the card on Today after noon) "Good morning" is skipped.
 */
export function greetingWord(ukDay: string, userId: string, morning = true): GreetingWord {
  const i = (dayNumber(ukDay) + (hash(userId) % GREETINGS.length)) % GREETINGS.length;
  const word = GREETINGS[i];
  if (word === 'Good morning' && !morning) return dayNumber(ukDay) % 2 === 0 ? 'Hi' : 'Hello';
  return word;
}

/** "Hi Sam," / "Good morning,". */
export function greetingLine(ukDay: string, userId: string, fullName: string | null | undefined, morning = true): string {
  const word = greetingWord(ukDay, userId, morning);
  const name = usableFirstName(fullName);
  return name ? `${word} ${name},` : `${word},`;
}
