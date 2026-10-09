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

export interface Figure {
  /** As written, e.g. "£38k". */
  raw: string;
  /** Its value, pounds for money ("80p" → 0.8, "£38k" → 38000). */
  value: number;
  money: boolean;
  percent: boolean;
}

// £ optional; 1,234 or 1234; .5 decimals; then k / m / bn / % / p stuck to it, but only when no
// other letter follows (so "£999pcm" is 999 and "18months" is 18, never "£9.99" or "18 million").
const FIGURE = /(£)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:(k|m|bn|%|p)(?![a-z]))?(?![0-9])/gi;

/** Every figure written in a text, in order. */
export function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const pound = Boolean(m[1]);
    const whole = m[2].replace(/,/g, '');
    let value = Number(m[3] ? `${whole}.${m[3]}` : whole);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[4] ?? '').toLowerCase();
    if (suffix === 'k') value *= 1_000;
    else if (suffix === 'm') value *= 1_000_000;
    else if (suffix === 'bn') value *= 1_000_000_000;
    else if (suffix === 'p') value /= 100;
    out.push({ raw: m[0].trim(), value, money: pound || suffix === 'p', percent: suffix === '%' });
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

/** Questions are plain text: control characters out, whitespace collapsed, cut to the log's limit. */
export function cleanQuestion(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Advice the chat must never give (the brief: "Should I buy this?" gets the
 * numbers and "Get a survey and your own advice before you offer."). A short,
 * explicit list: wording that is only ever a recommendation. Whole words,
 * any case.
 */
const ADVICE: readonly string[] = [
  'i recommend', "i'd recommend", 'i would recommend', 'my advice', 'my recommendation',
  'you should buy', 'you should rent', 'you should offer', 'you should go for', 'you should invest',
  'go for it', 'snap it up', 'buy it now', 'worth buying', 'a good investment', 'a safe bet',
  'guaranteed income', 'guaranteed return', 'guaranteed profit', 'is guaranteed to',
];

/** Whether an answer is only the don't-know line (or says it): never charged, whatever form the model put it in. */
export function saysDontKnow(text: string): boolean {
  return /i don['’]t know that one yet/i.test(text);
}

/** The advice phrases an answer uses (none: it may be shown). */
export function adviceIn(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ')} `;
  return ADVICE.filter((p) => new RegExp(`(^|[^a-z'])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t));
}
