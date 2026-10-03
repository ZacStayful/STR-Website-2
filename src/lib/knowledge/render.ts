/**
 * Batch 24: turning a knowledge entry into the words a member sees, and the
 * checks an entry must pass before Zac can approve it.
 *
 * renderEntry never returns a half-filled answer. Its result says why an
 * answer is not shown:
 *   hidden       the entry's show_when condition is false for this member
 *   skip         a member value is missing (no stored count, no member): not
 *                shown to this member, nothing wrong with the entry
 *   stale        a global value no longer resolves, or a name is unknown:
 *                the entry is wrong for everyone until Zac re-approves it
 *   unavailable  the settings could not be read: shown to nobody right now,
 *                and never marked stale on a read failure
 *
 * Pure: no network, no database, no server-only.
 */
import { createHash } from 'node:crypto';
import {
  ANSWER_HARD_MAX_CHARS,
  ANSWER_MAX_CHARS,
  ANSWER_MAX_SENTENCES,
  KB_CATEGORIES,
  KB_CHANNELS,
  QUESTION_MAX_CHARS,
  VARIANTS_MAX,
  VARIANT_MAX_CHARS,
  type KbCategory,
  type KbChannel,
} from './config.ts';
import { figureCheck } from './figures.ts';
import { CONDITIONS, PLACEHOLDERS, isCondition, isPlaceholder, type GlobalSnapshot, type MemberValues } from './placeholders.ts';
import { bareText, conditionCombos, parseTemplate, renderParsed, sentenceCount, type Part } from './template.ts';

/** What an entry says: the live columns, or a draft's proposal. */
export interface EntryContent {
  question: string;
  variants: string[];
  answer: string;
  category: KbCategory | string;
  channels: (KbChannel | string)[];
  showWhen: string | null;
}

/** An approved, live entry as members' code reads it (si_knowledge_live). */
export interface LiveEntry extends EntryContent {
  id: string;
  slug: string;
  version: number;
}

export type RenderResult =
  | { kind: 'ok'; question: string; answer: string }
  | { kind: 'hidden' }
  | { kind: 'skip'; missing: string[] }
  | { kind: 'stale'; reason: string; missing: string[] }
  | { kind: 'unavailable' };

function namesOf(parts: readonly Part[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind === 'ph') out.push(p.name);
    if (p.kind === 'section') p.body.forEach((b) => b.kind === 'ph' && out.push(b.name));
  }
  return out;
}

/** The resolvers a render uses, with optional forced condition values (previews). */
function resolvers(g: GlobalSnapshot, m: MemberValues | null, force: Record<string, boolean> = {}) {
  return {
    value: (name: string) => (isPlaceholder(name) ? PLACEHOLDERS[name].resolve(g, m) : null),
    cond: (name: string) => (name in force ? force[name] : isCondition(name) ? CONDITIONS[name].resolve(g, m) : null),
  };
}

function classify(missing: readonly string[]): 'stale' | 'skip' {
  // An unknown name, or any global value missing, is wrong for everyone.
  return missing.some((n) => (isPlaceholder(n) ? PLACEHOLDERS[n].scope === 'global' : isCondition(n) ? CONDITIONS[n].scope === 'global' : true)) ? 'stale' : 'skip';
}

/**
 * The question and answer as this member (or, with m null, anyone) would see
 * them now. `g` null = the settings could not be read.
 */
export function renderEntry(e: EntryContent, g: GlobalSnapshot | null, m: MemberValues | null): RenderResult {
  if (!g) return { kind: 'unavailable' };
  const q = parseTemplate(e.question);
  const a = parseTemplate(e.answer);
  if (!q.ok) return { kind: 'stale', reason: `The question doesn't parse: ${q.error}`, missing: [] };
  if (!a.ok) return { kind: 'stale', reason: `The answer doesn't parse: ${a.error}`, missing: [] };
  const unknown = [...q.placeholders, ...a.placeholders].filter((n) => !isPlaceholder(n)).concat([...q.conditions, ...a.conditions].filter((n) => !isCondition(n)));
  if (e.showWhen && !isCondition(e.showWhen)) unknown.push(e.showWhen);
  if (unknown.length) return { kind: 'stale', reason: `Unknown name${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, missing: unknown };
  const r = resolvers(g, m);
  if (e.showWhen) {
    const shown = r.cond(e.showWhen);
    if (shown === null) return classify([e.showWhen]) === 'stale' ? { kind: 'stale', reason: `${e.showWhen} no longer resolves`, missing: [e.showWhen] } : { kind: 'skip', missing: [e.showWhen] };
    if (!shown) return { kind: 'hidden' };
  }
  const qr = renderParsed(q.parts, r.value, r.cond);
  const ar = renderParsed(a.parts, r.value, r.cond);
  const missing = [...(qr.ok ? [] : qr.missing), ...(ar.ok ? [] : ar.missing)];
  if (missing.length) {
    return classify(missing) === 'stale' ? { kind: 'stale', reason: `No longer resolves: ${[...new Set(missing)].join(', ')}`, missing: [...new Set(missing)] } : { kind: 'skip', missing: [...new Set(missing)] };
  }
  return { kind: 'ok', question: (qr as { text: string }).text, answer: (ar as { text: string }).text };
}

/**
 * The global staleness of an entry, whoever is looking: the reason it is
 * wrong for everyone, or null. Member values are ignored (they are checked
 * per member when shown), and so is show_when being false.
 */
export function staleReason(e: EntryContent, g: GlobalSnapshot): string | null {
  const q = parseTemplate(e.question);
  const a = parseTemplate(e.answer);
  if (!q.ok) return `The question doesn't parse: ${q.error}`;
  if (!a.ok) return `The answer doesn't parse: ${a.error}`;
  const names = [...namesOf(q.parts), ...namesOf(a.parts)];
  const conds = [...q.conditions, ...a.conditions, ...(e.showWhen ? [e.showWhen] : [])];
  const unknown = [...names.filter((n) => !isPlaceholder(n)), ...conds.filter((n) => !isCondition(n))];
  if (unknown.length) return `Unknown name${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].join(', ')}`;
  const dead = [...names.filter((n) => PLACEHOLDERS[n].scope === 'global' && PLACEHOLDERS[n].resolve(g, null) === null), ...conds.filter((n) => CONDITIONS[n].scope === 'global' && CONDITIONS[n].resolve(g, null) === null)];
  return dead.length ? `No longer resolves: ${[...new Set(dead)].join(', ')}` : null;
}

/** A member for previews and the length check: every member value present. */
export const SAMPLE_MEMBER: MemberValues = {
  balancePence: 1240,
  checked: 1284,
  tailored: true,
  alertsByText: true,
  freeMember: true,
  packAvailable: true,
  welcome: { fullPence: 217, until: 'Friday 9 October' },
  firstDeepPence: 500,
  noMatch: 'Add Leeds and Bradford and I could show you 4 more deals.',
};

export interface ContentCheck {
  /** Each blocks saving (structure) or approval (figures, resolving). */
  errors: string[];
  warnings: string[];
  /** The answer as it reads in every combination of its conditions, for a sample member. */
  previews: { when: string; question: string; answer: string }[];
}

/**
 * Everything an entry must pass before it can be approved. With g null
 * (settings unreadable) the "resolves now" check is skipped and says so.
 */
export function checkContent(e: EntryContent, g: GlobalSnapshot | null): ContentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const previews: ContentCheck['previews'] = [];
  const question = e.question.trim();
  const answer = e.answer.trim();
  if (!question) errors.push('The question is empty.');
  if (question.length > QUESTION_MAX_CHARS) errors.push(`The question is over ${QUESTION_MAX_CHARS} characters.`);
  if (!answer) errors.push('The answer is empty.');
  if (answer.length > ANSWER_HARD_MAX_CHARS) errors.push(`The answer is over ${ANSWER_HARD_MAX_CHARS} characters.`);
  if (!(KB_CATEGORIES as readonly string[]).includes(e.category)) errors.push(`"${e.category}" is not a category.`);
  if (e.channels.length === 0) errors.push('Choose at least one channel.');
  for (const c of e.channels) if (!(KB_CHANNELS as readonly string[]).includes(c)) errors.push(`"${c}" is not a channel.`);
  if (e.variants.length > VARIANTS_MAX) errors.push(`At most ${VARIANTS_MAX} other phrasings.`);
  for (const v of e.variants) {
    if (!v.trim()) errors.push('A phrasing is empty.');
    if (v.length > VARIANT_MAX_CHARS) errors.push(`A phrasing is over ${VARIANT_MAX_CHARS} characters.`);
    if (/[{}]/.test(v)) errors.push('Phrasings are plain text: no {placeholders}.');
  }
  const q = parseTemplate(question);
  const a = parseTemplate(answer);
  if (!q.ok) errors.push(`Question: ${q.error}`);
  if (!a.ok) errors.push(`Answer: ${a.error}`);
  if (!q.ok || !a.ok) return { errors, warnings, previews };

  const placeholders = [...new Set([...q.placeholders, ...a.placeholders])];
  const conditions = [...new Set([...q.conditions, ...a.conditions])];
  const unknownP = placeholders.filter((n) => !isPlaceholder(n));
  const unknownC = conditions.filter((n) => !isCondition(n));
  if (unknownP.length) errors.push(`Unknown placeholder${unknownP.length > 1 ? 's' : ''}: ${unknownP.map((n) => `{${n}}`).join(', ')}.`);
  if (unknownC.length) errors.push(`Unknown condition${unknownC.length > 1 ? 's' : ''}: ${unknownC.join(', ')}.`);
  if (e.showWhen && !isCondition(e.showWhen)) errors.push(`"${e.showWhen}" is not a condition.`);

  // Calls: global figures only and no sections (the prompt is fixed between syncs; members are never named on a call).
  if (e.channels.includes('call')) {
    const memberNames = placeholders.filter((n) => isPlaceholder(n) && PLACEHOLDERS[n].scope === 'member');
    if (memberNames.length) errors.push(`An answer allowed on calls can't use a member's own values: ${memberNames.map((n) => `{${n}}`).join(', ')}.`);
    if (conditions.length) errors.push('An answer allowed on calls can’t have {#…} sections.');
    if (e.showWhen) errors.push('An answer allowed on calls can’t have a show-when condition.');
  }

  for (const [label, parsed] of [['Question', q], ['Answer', a]] as const) {
    const f = figureCheck(bareText(parsed.parts));
    for (const b of f.blocking) errors.push(`${label} types ${b}: use a placeholder.`);
    for (const w of f.warnings) warnings.push(`${label} has ${w}.`);
  }

  if (!g) {
    warnings.push("The settings couldn't be read, so whether every figure resolves now wasn't checked.");
    return { errors, warnings, previews };
  }
  const dead = placeholders.filter((n) => isPlaceholder(n) && PLACEHOLDERS[n].scope === 'global' && PLACEHOLDERS[n].resolve(g, null) === null);
  if (dead.length) errors.push(`These don't resolve from the settings now: ${dead.map((n) => `{${n}}`).join(', ')}.`);
  if (unknownP.length || unknownC.length || dead.length) return { errors, warnings, previews };

  for (const combo of conditionCombos(conditions)) {
    const r = resolvers(g, SAMPLE_MEMBER, combo);
    const qr = renderParsed(q.parts, r.value, r.cond);
    const ar = renderParsed(a.parts, r.value, r.cond);
    if (!qr.ok || !ar.ok) continue;
    const when = Object.entries(combo).map(([k, v]) => `${v ? '' : 'not '}${k}`).join(', ') || 'always';
    previews.push({ when, question: qr.text, answer: ar.text });
    if (sentenceCount(ar.text) > ANSWER_MAX_SENTENCES) warnings.push(`Over ${ANSWER_MAX_SENTENCES} sentences (${when}).`);
    if (ar.text.length > ANSWER_MAX_CHARS) warnings.push(`Over ${ANSWER_MAX_CHARS} characters (${when}): ${ar.text.length}.`);
  }
  return { errors, warnings: [...new Set(warnings)], previews };
}

/** A stable hash of what an entry says (draft or live), to tell exactly what was approved. */
export function contentHash(e: EntryContent): string {
  const canonical = JSON.stringify([e.question.trim(), e.variants.map((v) => v.trim()), e.answer.trim(), e.category, [...e.channels].sort(), e.showWhen ?? null]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** A draft as stored in si_knowledge.draft (snake_case, as the approve function reads it). */
export function draftJson(e: EntryContent): Record<string, unknown> {
  return { question: e.question.trim(), variants: e.variants.map((v) => v.trim()).filter(Boolean), answer: e.answer.trim(), category: e.category, channels: [...new Set(e.channels)], show_when: e.showWhen ?? '' };
}

/** The draft column back into content, defensively (anything malformed reads as empty). */
export function draftContent(raw: unknown): EntryContent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    question: typeof o.question === 'string' ? o.question : '',
    variants: strs(o.variants),
    answer: typeof o.answer === 'string' ? o.answer : '',
    category: typeof o.category === 'string' ? o.category : '',
    channels: strs(o.channels),
    showWhen: typeof o.show_when === 'string' && o.show_when ? o.show_when : null,
  };
}
