/**
 * Batch 26: the checks an answer passes before it is kept and charged for.
 * A quick answer is checked before the member sees it. A full-view answer
 * streams in as it is written, so the member can read a line for a moment
 * before the check runs; if it fails, the shown text is replaced with the
 * don't-know line, and that question is not charged.
 *
 * The figure guard: Stayful Intelligence never invents a figure. Every number
 * in an answer must be one it was given at that moment (an approved answer
 * rendered from settings, a tool's result, the member's own figures or the
 * question itself). A derived figure (a difference, a total) is refused too:
 * the persona says no arithmetic, and this is what enforces it. Small whole
 * numbers (0–10, no £ or %) are exempt: counts and ordinals ("2 deals").
 *
 * Pure.
 */
import { BANNED_GROUPS, phraseRe } from '../persona/stayful-intelligence.ts';

export interface Figure {
  /** As written, e.g. "£38k". */
  raw: string;
  /** Its value, pounds for money ("80p" → 0.8, "£38k" → 38000). */
  value: number;
  money: boolean;
  percent: boolean;
}

// £ optional; 1,234 or 1234; .5 decimals; then k / m / bn / % / p stuck to it, but only when no
// other letter follows (so "£999pcm" is 999 and "18months" is 18, never "£9.99" or "18 million"); or a
// unit in words after it (Review R3, R3-35: "5 pounds", "8 pence", "10 percent" are money and percent too).
const FIGURE = /(£)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:(k|m|bn|%|p)(?![a-z])|\s?(pounds?|pence|quid|per\s?cent|percent)(?![a-z]))?(?![0-9])/gi;

/** Every figure written in a text, in order. */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const pound = Boolean(m[1]);
    const whole = m[2].replace(/,/g, '');
    let value = Number(m[3] ? `${whole}.${m[3]}` : whole);
    if (!Number.isFinite(value)) continue;
    const word = (m[5] ?? '').toLowerCase().replace(/\s+/g, '');
    const suffix = word ? (word === 'pence' ? 'p' : word.startsWith('percent') ? '%' : '£') : (m[4] ?? '').toLowerCase();
    if (suffix === 'k') value *= 1_000;
    else if (suffix === 'm') value *= 1_000_000;
    else if (suffix === 'bn') value *= 1_000_000_000;
    else if (suffix === 'p') value /= 100;
    out.push({ raw: m[0].trim(), value, money: pound || suffix === 'p' || suffix === '£', percent: suffix === '%' });
  }
  return out;
}

type Kind = 'money' | 'percent' | 'plain';
const kindOf = (f: Figure): Kind => (f.money ? 'money' : f.percent ? 'percent' : 'plain');
const key = (kind: Kind, v: number): string => `${kind}:${Math.round(v * 10_000) / 10_000}`;

// Ids in tool results are not figures anyone was given.
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The figures a set of source texts allows, each with its kind: "£240" never allows a plain "240" count to become money. */
export function allowedFigures(sources: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    for (const f of figuresIn(s.replace(UUIDS, ' '))) out.add(key(kindOf(f), f.value));
  }
  return out;
}

/** A count or ordinal that needs no source. */
export function isExempt(f: Figure): boolean {
  return !f.money && !f.percent && Number.isInteger(f.value) && f.value >= 0 && f.value <= 10;
}

export type GuardResult = { ok: true } | { ok: false; figures: string[] };

/**
 * Every figure in the answer must be allowed (or exempt), as the same kind:
 * money only from money, a percentage only from a percentage. A plain number
 * may repeat any figure's value ("240 listings" from "checked: 240").
 */
export function checkFigures(answer: string, allowed: ReadonlySet<string>): GuardResult {
  const bad = figuresIn(answer)
    .filter((f) => {
      if (isExempt(f)) return false;
      const k = kindOf(f);
      if (k !== 'plain') return !allowed.has(key(k, f.value));
      return !(['money', 'percent', 'plain'] as const).some((kind) => allowed.has(key(kind, f.value)));
    })
    .map((f) => f.raw);
  return bad.length === 0 ? { ok: true } : { ok: false, figures: bad };
}

/** Words in a text. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Keeps an answer near its limit: over a quarter past it, it is cut at the
 * last full sentence inside the limit (or at the limit with "…").
 */
export function clampWords(text: string, maxWords: number): string {
  const t = text.trim();
  if (wordCount(t) <= Math.ceil(maxWords * 1.25)) return t;
  const words = t.split(/\s+/).slice(0, maxWords).join(' ');
  const end = Math.max(words.lastIndexOf('. '), words.lastIndexOf('? '), words.lastIndexOf('! '), words.endsWith('.') ? words.length - 1 : -1);
  return end > 0 ? words.slice(0, end + 1) : `${words}…`;
}

/**
 * Questions are plain text: control characters out, angle brackets out (a
 * typed "<approved_answer>" can never pass for one of ours in the prompt;
 * Review R3, R3-88), whitespace collapsed, cut to the log's limit.
 */
export function cleanQuestion(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Advice the chat must never give (the brief: "Should I buy this?" gets the
 * numbers and "Get a survey and your own advice before you offer."). The
 * chat's own list (wording that is only ever a recommendation) plus the
 * persona's banned advice, guarantees and predictions, matched the way the
 * briefing validator matches them (Review R3, R3-34: one list governs every
 * written channel). Whole words, any case. A phrase inside a caveat or a
 * condition ("before you buy it", "aren't guaranteed", "if you make an
 * offer") is not advice.
 */
const ADVICE: readonly string[] = [
  'i recommend', "i'd recommend", 'i would recommend', 'my advice', 'my recommendation',
  'you should buy', 'you should rent', 'you should offer', 'you should go for', 'you should invest',
  'go for it', 'snap it up', 'buy it now', 'worth buying', 'a good investment', 'a safe bet',
  'guaranteed income', 'guaranteed return', 'guaranteed profit', 'is guaranteed to',
];
/** The report's own forecast is a product the chat may name, not a prediction it makes: these stay the validator's. */
const PRODUCT_WORDS: ReadonlySet<string> = new Set(['forecast', 'expect', 'expected to', 'predict']);
const PHRASES: ReadonlyArray<{ p: string; re: RegExp }> = [
  ...new Set([...ADVICE, ...BANNED_GROUPS.advice, ...BANNED_GROUPS.guarantees, ...BANNED_GROUPS.predictions.filter((p) => !PRODUCT_WORDS.has(p))]),
].map((p) => ({ p, re: new RegExp(phraseRe(p).source, 'gi') }));
/** What can stand just before a phrase and make it a caveat or a condition rather than advice. */
const CAVEAT = /(?:\b(?:not|never|no|nothing|without|aren't|isn't|don't|doesn't|can't|cannot|won't|before|if|whether|unless|until)(?:\s+\w+){0,2}|\b(?:want|wants|decide|decided|plan|planning|going)\s+to)\s*$/;

/** Whether an answer is only the don't-know line (or says it): never charged, whatever form the model put it in. */
export function saysDontKnow(text: string): boolean {
  return /i don['’]t know that one yet/i.test(text);
}

const NON_ANSWER: readonly RegExp[] = [
  /\b(?:don['’]t|do not|cannot|can['’]t|couldn['’]t|unable to|not able to) (?:know|find|see|tell|help|answer|locate|access|say)\b/i,
  /\b(?:don['’]t|do not) have (?:that|any|the|this) (?:information|details?|data)\b/i,
  /\bno (?:information|details?|data|record|way of knowing)\b/i,
  /\bnothing (?:on|about|for) (?:that|this)\b/i,
  /\b(?:have|['’]ve) no (?:way|idea)\b/i,
  /\bi['’]m afraid i (?:don['’]t|can['’]t)\b/i,
];

/**
 * Review R3 (R3-85): a don't-know in the model's own words ("I can't find
 * anything on that", "I don't have that information") is a non-answer when
 * it carries no figure and no look-up fed it, and is never charged. Behind a
 * look-up, "I can't see a 3-bed in LS6 among your deals" is a real (negative)
 * answer.
 */
export function isNonAnswer(text: string, o: { usedTools: boolean }): boolean {
  if (saysDontKnow(text)) return true;
  if (o.usedTools || figuresIn(text).length > 0 || wordCount(text) > 60) return false;
  return NON_ANSWER.some((re) => re.test(text));
}

/** The advice phrases an answer uses (none: it may be shown). */
export function adviceIn(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ')} `;
  const out: string[] = [];
  for (const { p, re } of PHRASES) {
    for (const m of t.matchAll(re)) {
      if (CAVEAT.test(t.slice(0, (m.index ?? 0) + m[1].length))) continue;
      out.push(p);
      break;
    }
  }
  return out;
}

/** The text streamed so far without its last, possibly unfinished, token: what the stream guard checks. */
export function settledText(text: string): string {
  return text.replace(/\S*$/, '');
}

/**
 * Review R3 (R3-36): run on the text as it streams, against the figures the
 * round was given. True at the first figure the model was not given or the
 * first advice phrase: the page clears what it has shown and the rest of the
 * round stays off the screen (the check on the whole answer then refuses it,
 * or shows it if the figure turns out to be allowed).
 */
export function streamDisallowed(text: string, allowed: ReadonlySet<string>): boolean {
  const settled = settledText(text);
  return !checkFigures(settled, allowed).ok || adviceIn(settled).length > 0;
}
