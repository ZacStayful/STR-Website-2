/**
 * Batch 23b: the gate between the writer and the member.
 *
 * Every number, £ amount, percentage, time, date and spelled-out number in
 * the opener, the subject and the nudges must match an allowed form on the
 * fact sheet; no banned phrase (hype, guarantee, prediction, advice), no
 * comparison the sheet does not support, no address, postcode or link, no
 * exclamation mark. Anything else, and the template opener and the existing
 * subject are used instead, and nothing is charged.
 *
 * Pure: no network, no database, no server-only.
 */
import { BANNED_PHRASES } from '../persona/stayful-intelligence.ts';
import { allowedNumbers, numbersIn, type AllowedNumber } from './forms.ts';
import type { FactSheet } from './facts.ts';

export interface WriterOutput {
  opener: string;
  subject: string;
  nudges: string[];
}

export const OPENER_MAX_WORDS = 60;
export const SUBJECT_MAX_CHARS = 70;
export const NUDGE_MAX_WORDS = 25;

export type Rejection =
  | 'empty'
  | 'too_long'
  | 'sentences'
  | 'exclamation'
  | 'emoji'
  | 'off_sheet_number'
  | 'time_or_date'
  | 'banned_phrase'
  | 'comparison'
  | 'address'
  | 'link'
  | 'too_many_nudges';

export type Verdict = { ok: true } | { ok: false; reason: Rejection; detail: string };

/** What the validator checks against: the sheet's numbers, plus extra forms (the nudges' days) and anything forbidden for this member. */
export interface Allowed {
  numbers: AllowedNumber[];
  /** Comparison phrases the sheet supports (FactSheet.comparisons). */
  comparisons: string[];
  /** Strings that must never appear (case-insensitive): the member's deals' addresses, opened or not. */
  forbidden: string[];
}

export function allowedFor(sheet: FactSheet, extraForms: readonly string[] = [], forbidden: readonly string[] = []): Allowed {
  const forms = [...sheet.facts.flatMap((f) => f.forms), ...extraForms];
  return { numbers: allowedNumbers(forms), comparisons: [...sheet.comparisons], forbidden: forbidden.map((s) => s.trim()).filter((s) => s.length >= 4) };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (p: string) => new RegExp(`(^|[^a-z0-9'’])${escape(p.toLowerCase()).replace(/'/g, "['’]")}(?=$|[^a-z0-9'’])`, 'i');
const BANNED = BANNED_PHRASES.map((p) => ({ p, re: phraseRe(p) }));

/** Comparisons the writer may only make when the sheet supports one. */
const COMPARISON = /\b(than (usual|normal|average|last|yesterday|before|ever)|busiest|quietest|record|highest|lowest|best ever|most ever|more than ever|fewer than|more than|less than|above (the )?(usual|average|normal)|below (the )?(usual|average|normal))\b/i;

const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
/** An outcode or postcode area with a district number (LS6, M14, SW1A): case-sensitive, so prose never trips it. */
const OUTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\b/;
const STREET = /\b\d+[a-z]?,?\s+(?:[A-Z][a-z]+\s+){1,3}(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Drive|Dr|Way|Crescent|Court|Ct|Place|Pl|Terrace|Gardens|Grove|Hill|Park|Square|Row|Mews|View|Walk|Rise|Parade)\b/;
const LINK = /https?:|www\.|\.(co\.uk|com|org|net|uk)\b|@/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

function sameNumber(a: AllowedNumber, b: AllowedNumber): boolean {
  return a.unit === b.unit && Math.abs(a.value - b.value) < 1e-6;
}

/** One piece of text against the sheet. */
export function checkText(text: string, allowed: Allowed): Verdict {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'empty', detail: '' };
  if (/[!¡]/.test(t)) return { ok: false, reason: 'exclamation', detail: '!' };
  if (EMOJI.test(t)) return { ok: false, reason: 'emoji', detail: '' };
  if (LINK.test(t)) return { ok: false, reason: 'link', detail: t.match(LINK)?.[0] ?? '' };
  for (const f of allowed.forbidden) if (t.toLowerCase().includes(f.toLowerCase())) return { ok: false, reason: 'address', detail: f };
  if (POSTCODE.test(t)) return { ok: false, reason: 'address', detail: t.match(POSTCODE)?.[0] ?? '' };
  if (OUTCODE.test(t)) return { ok: false, reason: 'address', detail: t.match(OUTCODE)?.[0] ?? '' };
  if (STREET.test(t)) return { ok: false, reason: 'address', detail: t.match(STREET)?.[0] ?? '' };
  for (const b of BANNED) if (b.re.test(t)) return { ok: false, reason: 'banned_phrase', detail: b.p };
  // Every comparison must be one the sheet supports: take those out, then look for any other.
  let rest = t;
  for (const c of allowed.comparisons) rest = rest.replace(new RegExp(escape(c), 'gi'), ' ');
  const cmp = rest.match(COMPARISON);
  if (cmp) return { ok: false, reason: 'comparison', detail: cmp[0] };
  const found = numbersIn(t);
  if (found.times.length > 0) return { ok: false, reason: 'time_or_date', detail: found.times[0] };
  for (const n of found.numbers) {
    if (!allowed.numbers.some((a) => sameNumber(a, n))) return { ok: false, reason: 'off_sheet_number', detail: `${n.unit} ${n.value}` };
  }
  return { ok: true };
}

/** Sentences: full stops, question marks and colons ending a clause; "about £8.4k" is not a sentence break. */
export function sentenceCount(text: string): number {
  return text
    .replace(/(\d)\.(\d)/g, '$1$2')
    .split(/[.?…]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/** The whole briefing: opener (2–3 sentences, ≤60 words), subject (≤70 characters), at most two nudges. */
export function validateBriefing(out: WriterOutput, allowed: Allowed, maxNudges = 2): Verdict {
  const opener = out.opener?.trim() ?? '';
  const subject = out.subject?.trim() ?? '';
  if (!opener || !subject) return { ok: false, reason: 'empty', detail: opener ? 'subject' : 'opener' };
  if (words(opener) > OPENER_MAX_WORDS) return { ok: false, reason: 'too_long', detail: `opener ${words(opener)} words` };
  const n = sentenceCount(opener);
  if (n < 2 || n > 3) return { ok: false, reason: 'sentences', detail: `${n}` };
  if (subject.length > SUBJECT_MAX_CHARS) return { ok: false, reason: 'too_long', detail: `subject ${subject.length} chars` };
  const nudges = (out.nudges ?? []).map((x) => x.trim()).filter(Boolean);
  if (nudges.length > maxNudges) return { ok: false, reason: 'too_many_nudges', detail: `${nudges.length}` };
  for (const x of nudges) if (words(x) > NUDGE_MAX_WORDS) return { ok: false, reason: 'too_long', detail: `nudge ${words(x)} words` };
  for (const [part, text] of [['opener', opener], ['subject', subject], ...nudges.map((x, i) => [`nudge ${i + 1}`, x])] as [string, string][]) {
    const v = checkText(text, allowed);
    if (!v.ok) return { ok: false, reason: v.reason, detail: `${part}: ${v.detail}` };
  }
  return { ok: true };
}
