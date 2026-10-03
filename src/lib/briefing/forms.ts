/**
 * Batch 23b: the ways a number on the fact sheet may be said.
 *
 * The briefing's writer never does arithmetic: every figure it may use is
 * worked out here, in code, with the spoken forms it may take ("£8,432",
 * "about £8,400", "over £8,000"). The validator (./validator.ts) then checks
 * every number in what came back against these forms and nothing else.
 *
 * Pure: no network, no database, no server-only.
 */

export type NumberUnit = 'count' | 'money' | 'percent';

/** One allowed number: its unit and value. "about £8,400" allows money 8400. */
export interface AllowedNumber {
  unit: NumberUnit;
  value: number;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** "three" for 3, up to twenty; null above. */
export function spelled(n: number): string | null {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : null;
}

/** "1,240". */
export function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}

/** Round to `sig` significant figures: 8432 → 8400 (2), 8000 (1). */
export function roundSig(n: number, sig: number): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(n))) - sig + 1));
  return Math.round(n / p) * p;
}

/** Down to one significant figure: 8432 → 8000, 1240 → 1000. */
function floorSig1(n: number): number {
  if (n <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  return Math.floor(n / p) * p;
}

/** The rounded values a figure may be given as, besides the exact one. */
function roundings(n: number): { about: number[]; over: number | null } {
  const about = new Set<number>();
  if (n >= 20) {
    const two = roundSig(n, 2);
    if (two !== n) about.add(two);
    const one = roundSig(n, 1);
    // "about 400" for 412 is fair; "about 1,000" for 1,449 is not.
    if (one !== n && Math.abs(one - n) / n <= 0.15) about.add(one);
  }
  const over = n >= 20 ? floorSig1(n) : null;
  return { about: [...about].sort((a, b) => a - b), over: over !== null && over < n ? over : null };
}

/** A count: "1,240", "about 1,200", "over 1,000", and "three" for small ones. */
export function countForms(n: number): string[] {
  const v = Math.max(0, Math.round(n));
  const out = [grouped(v)];
  const w = spelled(v);
  if (w) out.push(w);
  const { about, over } = roundings(v);
  for (const a of about) out.push(`about ${grouped(a)}`);
  if (over !== null) out.push(`over ${grouped(over)}`);
  return out;
}

/** "once", "twice", "three times". */
export function timesForms(n: number): string[] {
  const v = Math.max(0, Math.round(n));
  if (v === 1) return ['once', '1 time'];
  if (v === 2) return ['twice', 'two times', '2 times'];
  const w = spelled(v);
  return [`${grouped(v)} times`, ...(w ? [`${w} times`] : [])];
}

/** Money in whole pounds: "£8,432", "about £8,400", "over £8,000". */
export function moneyForms(pounds: number, suffix = ''): string[] {
  const v = Math.round(pounds);
  const s = suffix ? ` ${suffix}` : '';
  const out = [`£${grouped(v)}${s}`];
  const { about, over } = roundings(v);
  for (const a of about) out.push(`about £${grouped(a)}${s}`);
  if (over !== null) out.push(`over £${grouped(over)}${s}`);
  return out;
}

/** A whole percentage: "12%", "12 per cent". */
export function percentForms(pct: number): string[] {
  const v = Math.round(pct);
  return [`${v}%`, `${v} per cent`];
}

/** Days: "4 days", "four days" ("1 day", "a day"). */
export function dayForms(n: number): string[] {
  const v = Math.max(0, Math.round(n));
  const w = spelled(v);
  if (v === 1) return ['1 day', 'one day', 'a day'];
  return [`${v} days`, ...(w ? [`${w} days`] : [])];
}

/**
 * Time from minutes, said the way Home's tile says it (aboutLabel in
 * src/lib/home/config.ts): "about 9 hours", "about 20 minutes".
 */
export function durationForms(minutes: number): string[] {
  if (!Number.isFinite(minutes) || minutes <= 0) return [];
  if (minutes < 59.5) {
    const m = Math.max(1, Math.round(minutes));
    const w = spelled(m);
    return [`about ${m} minute${m === 1 ? '' : 's'}`, ...(w ? [`about ${w} minute${m === 1 ? '' : 's'}`] : [])];
  }
  const h = Math.round(minutes / 60);
  const w = spelled(h);
  return [`about ${h} hour${h === 1 ? '' : 's'}`, ...(w ? [`about ${w} hour${h === 1 ? '' : 's'}`] : []), ...(h === 1 ? ['about an hour'] : [])];
}

// ── Reading numbers back out of text (the validator's side) ──

const WORD_VALUE: Record<string, number> = Object.fromEntries(WORDS.map((w, i) => [w, i]));
Object.assign(WORD_VALUE, {
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1_000_000,
  once: 1, twice: 2, thrice: 3, couple: 2, dozen: 12, half: 0.5, double: 2, triple: 3,
  third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
});

/** Every spelled-out number word the validator recognises, lower case. */
export const NUMBER_WORDS: ReadonlySet<string> = new Set(Object.keys(WORD_VALUE));

export function wordValue(word: string): number | null {
  const v = WORD_VALUE[word.toLowerCase()];
  return v === undefined ? null : v;
}

const MULT: Record<string, number> = { k: 1000, m: 1_000_000, bn: 1_000_000_000 };

/** "8,432" / "8.4" / "8.4k" → a number. */
export function parseFigure(raw: string, mult?: string | null): number | null {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n * (mult ? MULT[mult.toLowerCase()] ?? 1 : 1);
}

/** Every number the forms allow, by unit: what a validator compares against. */
export function allowedNumbers(forms: readonly string[]): AllowedNumber[] {
  const out: AllowedNumber[] = [];
  for (const f of forms) for (const n of numbersIn(f).numbers) out.push(n);
  return out;
}

export interface FoundNumbers {
  numbers: AllowedNumber[];
  /** Clock times and dates, which no form gives: the validator rejects any. */
  times: string[];
}

/**
 * The numbers said in a piece of text, with their unit. Money is anything
 * after a £; a percentage is anything before % or "per cent"; every other
 * figure and every number word is a count.
 */
export function numbersIn(text: string): FoundNumbers {
  const numbers: AllowedNumber[] = [];
  const times: string[] = [];
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      fn(m);
      return ' ';
    });
  };
  // Clock times: 07:40, 7.40am, 7am.
  take(/\b\d{1,2}[:.]\d{2}\s?(?:am|pm)?\b|\b\d{1,2}\s?(?:am|pm)\b/gi, (m) => times.push(m[0]));
  // Dates: 3/10, 03-10-2026, 3rd October.
  take(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, (m) => times.push(m[0]));
  take(/£\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|bn)?\b/gi, (m) => {
    const v = parseFigure(m[1], m[2]);
    if (v !== null) numbers.push({ unit: 'money', value: v });
  });
  take(/(\d[\d,]*(?:\.\d+)?)\s?(?:%|per\s?cent\b|percent\b)/gi, (m) => {
    const v = parseFigure(m[1]);
    if (v !== null) numbers.push({ unit: 'percent', value: v });
  });
  take(/(\d[\d,]*(?:\.\d+)?)(?:st|nd|rd|th)?\s?(k)?\b/gi, (m) => {
    const v = parseFigure(m[1], m[2]);
    if (v !== null) numbers.push({ unit: 'count', value: v });
  });
  for (const w of rest.toLowerCase().match(/[a-z]+/g) ?? []) {
    const v = wordValue(w);
    if (v !== null) numbers.push({ unit: 'count', value: v });
  }
  return { numbers, times };
}
