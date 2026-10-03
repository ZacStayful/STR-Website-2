/**
 * Batch 24: the phone agent's knowledge, generated from the knowledge base.
 *
 * The agent (Batch 23, ElevenLabs) answers from text in its prompt, synced
 * from /admin/calls and after every approval that touches a call answer.
 * Only approved, live entries allowed on calls are in it, one line each:
 * "[slug] question: answer". Their figures are not written into the prompt:
 * each {placeholder} becomes the ElevenLabs dynamic variable {{k_<name>}},
 * filled on every call from the settings at that moment (callVariables), so
 * a price change reaches the next call with no edit and no sync.
 *
 * ElevenLabs refuses to start a call if a variable the prompt uses is not
 * sent. So the variable list is fixed here, from code (every global
 * placeholder, whatever is approved), and every call sends all of it; a
 * figure that can't be read at dial time is sent as CALL_FIGURE_FALLBACK
 * ("shown in the app") rather than stopping the call.
 *
 * Pure: no network, no database, no server-only.
 */
import { createHash } from 'node:crypto';
import { CALL_FIGURE_FALLBACK } from './config.ts';
import { CALL_PLACEHOLDERS, PLACEHOLDERS, isPlaceholder, type GlobalSnapshot } from './placeholders.ts';
import type { LiveEntry } from './render.ts';
import { parseTemplate, tidy, type Part } from './template.ts';

/** The ElevenLabs variable a placeholder becomes in the agent's prompt. */
export const variableFor = (placeholder: string): string => `k_${placeholder}`;

/** Every knowledge variable a call sends: fixed by code, never by what is approved. */
export const KNOWLEDGE_VARIABLES: readonly string[] = CALL_PLACEHOLDERS.map(variableFor);

/**
 * The answers the agent must have before its knowledge may be replaced: the
 * ones that took over from Batch 23's service guide. Until each is approved
 * and live, a sync is refused and the agent keeps what it has, so a
 * half-approved knowledge base can never wipe what it knows.
 */
export const REQUIRED_CALL_SLUGS: readonly string[] = ['what_it_does', 'how_picks_work', 'reports', 'credit_how', 'auto_topup', 'calls_how', 'stop_calls', 'phone_privacy', 'talk_to_team', 'management'];

function toPrompt(parts: readonly Part[]): string | null {
  let out = '';
  for (const p of parts) {
    if (p.kind === 'section') return null; // never on a call (approval refuses it too)
    if (p.kind === 'text') out += p.text;
    else {
      if (!isPlaceholder(p.name) || PLACEHOLDERS[p.name].scope !== 'global') return null;
      out += `{{${variableFor(p.name)}}}`;
    }
  }
  return tidy(out.replace(/\s*\n\s*/g, ' '));
}

export interface AgentKnowledge {
  /** The text for the prompt's knowledge section. */
  text: string;
  /** The slugs in it, in order. */
  slugs: string[];
  /** Live call entries left out, and why. */
  skipped: { slug: string; reason: string }[];
  /** Required slugs with no live call answer: a sync is refused while any is missing. */
  missingRequired: string[];
  /** A fingerprint of the text: the agent is in step when the synced one matches. */
  hash: string;
}

/**
 * The agent's knowledge from the live entries allowed on calls. An entry is
 * left out if it uses a member's own value or a section (never allowed on a
 * call), or a figure that doesn't resolve from the settings now.
 */
export function agentKnowledge(entries: readonly LiveEntry[], g: GlobalSnapshot): AgentKnowledge {
  const lines: string[] = [];
  const slugs: string[] = [];
  const skipped: AgentKnowledge['skipped'] = [];
  for (const e of [...entries].filter((x) => x.channels.includes('call')).sort((a, b) => a.slug.localeCompare(b.slug))) {
    const q = parseTemplate(e.question);
    const a = parseTemplate(e.answer);
    if (!q.ok || !a.ok) {
      skipped.push({ slug: e.slug, reason: "doesn't parse" });
      continue;
    }
    if (e.showWhen) {
      skipped.push({ slug: e.slug, reason: 'has a show-when condition' });
      continue;
    }
    const dead = [...q.placeholders, ...a.placeholders].filter((n) => !isPlaceholder(n) || PLACEHOLDERS[n].scope !== 'global' || PLACEHOLDERS[n].resolve(g, null) === null);
    if (dead.length) {
      skipped.push({ slug: e.slug, reason: `can't use ${dead.join(', ')} on a call now` });
      continue;
    }
    const qt = toPrompt(q.parts);
    const at = toPrompt(a.parts);
    if (qt === null || at === null) {
      skipped.push({ slug: e.slug, reason: "uses a member's own value or a section" });
      continue;
    }
    lines.push(`[${e.slug}] ${qt} ${at}`);
    slugs.push(e.slug);
  }
  const text = lines.join('\n');
  const missingRequired = REQUIRED_CALL_SLUGS.filter((s) => !slugs.includes(s));
  return { text, slugs, skipped, missingRequired, hash: createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

/**
 * Every knowledge variable with its value now. A figure that doesn't resolve
 * (or a snapshot that couldn't be read: g null) is sent as the fallback, and
 * named in `unresolved`.
 */
export function knowledgeVariables(g: GlobalSnapshot | null): { values: Record<string, string>; unresolved: string[] } {
  const values: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const name of CALL_PLACEHOLDERS) {
    const v = g ? PLACEHOLDERS[name].resolve(g, null) : null;
    if (v === null) unresolved.push(name);
    values[variableFor(name)] = v ?? CALL_FIGURE_FALLBACK;
  }
  return { values, unresolved };
}

/** The {{name}} variables a prompt uses (to refuse a sync that would use one no call sends). */
export function promptVariables(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))];
}
