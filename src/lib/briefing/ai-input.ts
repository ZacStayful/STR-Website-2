/**
 * Batch 23b: what the writer is given, and how it is asked.
 *
 * The input is built from the fact sheet alone and holds only: the weekday,
 * the chosen angle, the angle's facts (a label and the allowed forms), the
 * comparison and place words the sheet allows, the nudges (stage, days, town
 * and type) and the member's recent angles. No listing title, description,
 * agent text, address, postcode or link can reach it: the sheet has no field
 * for one (src/lib/briefing/facts.ts), and aiInputKeys() is what a test
 * holds this to.
 *
 * Pure: no network, no database, no server-only.
 */
import { buildSystemPrompt } from '../persona/stayful-intelligence.ts';
import { ANGLES, type AngleId } from './angles.ts';
import { factOf, type FactSheet } from './facts.ts';
import type { NudgeLink } from './nudges.ts';
import { NUDGE_MAX_WORDS, OPENER_MAX_WORDS, SUBJECT_MAX_CHARS } from './validator.ts';
import { dayForms } from './forms.ts';
import type { OverdueDeal } from './facts.ts';

export interface AiInput {
  weekday: string;
  angle: { id: AngleId; about: string };
  facts: { label: string; forms: string[] }[];
  comparisons: string[];
  places: string[];
  nudges: { stage: string; days: string[]; what: string; nextStep: string }[];
  recentAngles: AngleId[];
}

/** The top-level keys an AiInput may have: anything else is a leak. */
export const AI_INPUT_KEYS = ['weekday', 'angle', 'facts', 'comparisons', 'places', 'nudges', 'recentAngles'] as const;

export function buildAiInput(sheet: FactSheet, angle: AngleId, recent: readonly (AngleId | null)[], overdue: readonly OverdueDeal[], links: readonly NudgeLink[]): AiInput {
  const facts = ANGLES[angle].facts.map((id) => factOf(sheet, id)).filter((f): f is NonNullable<typeof f> => f !== null).map((f) => ({ label: f.label, forms: f.forms }));
  const nudges = links.map((l) => {
    const d = overdue.find((o) => o.key === l.key)!;
    return { stage: d.stageLabel, days: dayForms(d.days), what: [d.type ?? 'deal', d.town ? `in ${d.town}` : null].filter(Boolean).join(' '), nextStep: l.nextStep };
  });
  return {
    weekday: sheet.weekday,
    angle: { id: angle, about: ANGLES[angle].about },
    facts,
    comparisons: angle === 'thin_night' ? sheet.comparisons : [],
    places: sheet.places,
    nudges,
    recentAngles: recent.filter((x): x is AngleId => Boolean(x)).slice(0, 3),
  };
}

/** Every number form a nudge may use: the validator allows these on top of the sheet. */
export function nudgeForms(overdue: readonly OverdueDeal[], links: readonly NudgeLink[]): string[] {
  return links.flatMap((l) => {
    const d = overdue.find((o) => o.key === l.key);
    return d ? dayForms(d.days) : [];
  });
}

/** The task added to the persona's email channel for the briefing. */
export const BRIEFING_TASK = [
  'Task: write the opening of this member\'s daily email, the morning briefing.',
  `- opener: ${2}–${3} sentences, at most ${OPENER_MAX_WORDS} words, about the one angle given and nothing else. The greeting is added for you: do not greet.`,
  `- subject: one line, at most ${SUBJECT_MAX_CHARS} characters, from the same angle. No greeting, no full stop at the end.`,
  `- nudges: one line for each nudge given (none if none), at most ${NUDGE_MAX_WORDS} words each, saying how long the deal has sat in its stage. The link and the next step are added for you.`,
  '- Every figure must be one of the forms listed for a fact, copied exactly. Never write any other number, date or time, in digits or in words ("one", "twice", "a few dozen").',
  '- Places: only the words under places. Never an address, street or postcode.',
  '- Comparisons: only the phrases under comparisons, if any.',
  '- Never: predictions, advice to buy, hype, guarantees, exclamation marks.',
  'Reply with JSON only: {"opener": "…", "subject": "…", "nudges": ["…"]}.',
].join('\n');

export function briefingSystemPrompt(): string {
  return buildSystemPrompt('email', BRIEFING_TASK);
}

/** The user message: the input as JSON. */
export function briefingUserMessage(input: AiInput): string {
  return JSON.stringify(input);
}
