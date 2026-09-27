/**
 * Fills the next-step text (next-steps.ts) with a deal's details.
 *
 * The rules, which the content file's header repeats in plain English:
 *   {field}        replaced by the value.
 *   [ ... ]        kept only when EVERY field inside it is known; otherwise
 *                  the whole bracket disappears. One line, no nesting, and at
 *                  least one field inside.
 *   A {field} outside brackets that is missing drops its whole line. That is
 *   a safety net: the content checks require brackets in messages, so a
 *   member never sees a half-sentence.
 *   A line left empty (or only punctuation) is removed. Blank lines written
 *   in the text are kept as paragraph breaks, one at most in a row.
 *
 * Values are inserted once and never read again as template syntax, so an
 * address containing a bracket cannot change what is shown.
 *
 * Pure: no network, no database, no `server-only`, no content. Client
 * components may import mailtoHref from here.
 */
import type { Fields } from './types.ts';

const TOKEN = /\[([^[\]\n]*)\]|\{([A-Za-z]+)\}/g;
const FIELD = /\{([A-Za-z]+)\}/g;

/** A value as it goes into text: trimmed, one line, or null when there is nothing to show. */
export function cleanValue(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

function fillLine(line: string, fields: Fields): string | null {
  let dropLine = false;
  const out = line.replace(TOKEN, (_match, inner: string | undefined, bare: string | undefined) => {
    if (bare !== undefined) {
      const v = cleanValue(fields[bare]);
      if (v === null) dropLine = true;
      return v ?? '';
    }
    const names = [...(inner ?? '').matchAll(FIELD)].map((m) => m[1]);
    if (names.length === 0 || names.some((n) => cleanValue(fields[n]) === null)) return '';
    return (inner ?? '').replace(FIELD, (_m, n: string) => cleanValue(fields[n]) ?? '');
  });
  if (dropLine) return null;
  const tidy = tidyLine(out);
  return /^[\s\p{P}\-–—•]*$/u.test(tidy) ? null : tidy;
}

/** Spacing and punctuation left behind when a bracket drops out. */
export function tidyLine(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:?)])/g, '$1')
    .replace(/\( +/g, '(')
    .replace(/,\s*([.,;:?])/g, '$1')
    .replace(/\(\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The text with every field filled or dropped, as a member will see it. */
export function fillTemplate(template: string, fields: Fields): string {
  const lines: string[] = [];
  for (const raw of template.split('\n')) {
    if (raw.trim() === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    const line = fillLine(raw, fields);
    if (line !== null) lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** A mail link with the subject and body filled in and no recipient. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
}

export interface TemplateCheckOptions {
  /** Field names this text may use. */
  allowed: readonly string[];
  /** Whether a field may sit outside brackets (only where the code guarantees it is filled). */
  bareAllowed: boolean;
}

/**
 * Problems with a piece of content, in plain words, for the content tests:
 * the checks that stop an edit from ever showing a member a raw {field}.
 */
export function checkTemplate(template: string, opts: TemplateCheckOptions): string[] {
  const problems: string[] = [];
  if (template.includes('!')) problems.push('uses an exclamation mark');
  template.split('\n').forEach((line, i) => {
    const where = `line ${i + 1}`;
    let depth = 0;
    for (const ch of line) {
      if (ch === '[') {
        if (depth > 0) problems.push(`${where}: a bracket inside a bracket`);
        depth += 1;
      } else if (ch === ']') {
        if (depth === 0) problems.push(`${where}: a ] with no [`);
        depth = Math.max(0, depth - 1);
      }
    }
    if (depth > 0) problems.push(`${where}: a [ that is not closed on the same line`);
    // Every { must start a well-formed {name}.
    const stray = line.replace(FIELD, '');
    if (stray.includes('{') || stray.includes('}')) problems.push(`${where}: a { or } that is not a {field}`);
    for (const m of line.matchAll(/\[([^[\]]*)\]/g)) {
      const names = [...m[1].matchAll(FIELD)].map((x) => x[1]);
      if (names.length === 0) problems.push(`${where}: a bracket with no {field} in it`);
    }
    for (const m of line.matchAll(FIELD)) {
      if (!opts.allowed.includes(m[1])) problems.push(`${where}: unknown field {${m[1]}}`);
    }
    if (!opts.bareAllowed) {
      const outside = line.replace(/\[[^[\]]*\]/g, '');
      for (const m of outside.matchAll(FIELD)) problems.push(`${where}: {${m[1]}} must be inside [brackets]`);
    }
  });
  return problems;
}
