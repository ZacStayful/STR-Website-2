/**
 * Batch 24: what Stayful Intelligence may remember about a member.
 *
 * A fact is saved only after the member said yes to "Want me to remember
 * that?" (the caller passes confirmed: true and the question asked). Never
 * kept: health, protected characteristics, money beyond what the profile
 * already holds (budget, cash, deposit, mortgage), anything about other
 * people, or contact and card details. The agent and the chat are told never
 * to ask to remember those; these rules are the backstop.
 *
 * Pure: no network, no database, no server-only.
 */
import { FACT_ASKED_MAX_CHARS, FACT_MAX_CHARS, SENSITIVE_TERMS } from './config.ts';

export type FactRefusal = 'not_confirmed' | 'empty' | 'too_long' | 'sensitive' | 'personal_details';

export type FactCheck = { ok: true; fact: string; asked: string | null } | { ok: false; reason: FactRefusal; detail?: string };

const PERSONAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'an email address'],
  [/https?:\/\/|www\./i, 'a link'],
  [/(?:\d[\s-]?){7,}/, 'a phone or card number'],
  [/\b[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}\b/i, 'a full postcode'],
];

/** The sensitive topic a fact touches, or null. Whole words (and phrases), case-insensitive. */
export function sensitiveTopic(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [topic, terms] of Object.entries(SENSITIVE_TERMS)) {
    for (const term of terms) if (t.includes(` ${term} `)) return topic;
  }
  return null;
}

export function checkFact(input: { fact: unknown; asked?: unknown; confirmed: unknown }): FactCheck {
  if (input.confirmed !== true) return { ok: false, reason: 'not_confirmed' };
  const fact = typeof input.fact === 'string' ? input.fact.replace(/\s+/g, ' ').trim() : '';
  if (!fact) return { ok: false, reason: 'empty' };
  if (fact.length > FACT_MAX_CHARS) return { ok: false, reason: 'too_long', detail: `at most ${FACT_MAX_CHARS} characters` };
  const topic = sensitiveTopic(fact);
  if (topic) return { ok: false, reason: 'sensitive', detail: topic };
  for (const [re, what] of PERSONAL) if (re.test(fact)) return { ok: false, reason: 'personal_details', detail: what };
  const asked = typeof input.asked === 'string' && input.asked.trim() ? input.asked.replace(/\s+/g, ' ').trim().slice(0, FACT_ASKED_MAX_CHARS) : null;
  return { ok: true, fact, asked };
}
