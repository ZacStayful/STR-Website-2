/**
 * Batch 24: the knowledge base's answer templates.
 *
 *   {name}               a placeholder: a live figure or a member's value,
 *                        resolved when the answer is shown (./placeholders.ts)
 *   {#cond}…{/cond}      a section shown only when the condition is true
 *   {^cond}…{/cond}      a section shown only when it is false
 *
 * Sections are flat (no section inside another) and hold plain text and
 * placeholders. Anything else in braces is an error, so a typo can never
 * reach a member as literal text.
 *
 * Pure: no network, no database, no server-only.
 */

export type Piece = { kind: 'text'; text: string } | { kind: 'ph'; name: string };
export type Part = Piece | { kind: 'section'; cond: string; negate: boolean; body: Piece[] };

export type Parsed = { ok: true; parts: Part[]; placeholders: string[]; conditions: string[] } | { ok: false; error: string };

const NAME = '[a-z][a-z0-9_]{0,47}';
const TOKEN = new RegExp(`\\{(#|\\^|/)?(${NAME})\\}`, 'g');

export function parseTemplate(source: string): Parsed {
  const parts: Part[] = [];
  const placeholders = new Set<string>();
  const conditions = new Set<string>();
  let open: { cond: string; negate: boolean; body: Piece[] } | null = null;
  let last = 0;
  const push = (p: Piece) => (open ? open.body.push(p) : parts.push(p));
  const text = (t: string): string | null => {
    if (!t) return null;
    if (/[{}]/.test(t)) return `Unexpected brace near "${t.slice(Math.max(0, t.search(/[{}]/) - 10), t.search(/[{}]/) + 10)}".`;
    push({ kind: 'text', text: t });
    return null;
  };
  for (const m of source.matchAll(TOKEN)) {
    const err = text(source.slice(last, m.index));
    if (err) return { ok: false, error: err };
    last = (m.index ?? 0) + m[0].length;
    const [, sigil, name] = m;
    if (!sigil) {
      placeholders.add(name);
      push({ kind: 'ph', name });
    } else if (sigil === '/') {
      if (!open || open.cond !== name) return { ok: false, error: `{/${name}} closes a section that is not open.` };
      parts.push({ kind: 'section', cond: open.cond, negate: open.negate, body: open.body });
      open = null;
    } else {
      if (open) return { ok: false, error: `{${sigil}${name}} opens a section inside {${open.negate ? '^' : '#'}${open.cond}}; sections cannot be nested.` };
      conditions.add(name);
      open = { cond: name, negate: sigil === '^', body: [] };
    }
  }
  const err = text(source.slice(last));
  if (err) return { ok: false, error: err };
  if (open) return { ok: false, error: `{${open.negate ? '^' : '#'}${open.cond}} is never closed.` };
  return { ok: true, parts, placeholders: [...placeholders], conditions: [...conditions] };
}

export type Rendered = { ok: true; text: string } | { ok: false; missing: string[] };

/**
 * The text with every shown section's placeholders filled. A placeholder or
 * condition that resolves to null makes the whole render fail (listing the
 * names), so a half-filled answer is never returned. Placeholders inside a
 * hidden section need not resolve.
 */
export function renderParsed(parts: readonly Part[], value: (name: string) => string | null, cond: (name: string) => boolean | null): Rendered {
  const missing = new Set<string>();
  let out = '';
  const piece = (p: Piece) => {
    if (p.kind === 'text') out += p.text;
    else {
      const v = value(p.name);
      if (v === null) missing.add(p.name);
      else out += v;
    }
  };
  for (const p of parts) {
    if (p.kind !== 'section') {
      piece(p);
      continue;
    }
    const c = cond(p.cond);
    if (c === null) {
      missing.add(p.cond);
      continue;
    }
    if (c !== p.negate) p.body.forEach(piece);
  }
  if (missing.size > 0) return { ok: false, missing: [...missing] };
  return { ok: true, text: tidy(out) };
}

/** Double spaces and a space before punctuation, left by a hidden section, are removed. */
export function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,;:!?)])/g, '$1')
    .replace(/\( /g, '(')
    .trim();
}

/** The text with every placeholder and section marker removed (for the figure check), section bodies kept. */
export function bareText(parts: readonly Part[]): string {
  let out = '';
  for (const p of parts) {
    if (p.kind === 'text') out += p.text;
    else if (p.kind === 'ph') out += ' ';
    else for (const b of p.body) out += b.kind === 'text' ? b.text : ' ';
  }
  return out;
}

/** Every combination of the template's conditions (for previews and length checks), at most 2^limit. */
export function conditionCombos(conditions: readonly string[], limit = 4): Record<string, boolean>[] {
  const names = conditions.slice(0, limit);
  const out: Record<string, boolean>[] = [];
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const combo: Record<string, boolean> = {};
    names.forEach((n, i) => (combo[n] = Boolean(mask & (1 << i))));
    out.push(combo);
  }
  return out;
}

/** Sentences in rendered text: a full stop, ? or ! followed by a space or the end (so "£2.17" is one). */
export function sentenceCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const ends = t.match(/[.!?](\s|$)/g)?.length ?? 0;
  return /[.!?]$/.test(t) ? ends : ends + 1;
}
