/**
 * Part E: what a member's "About you" answers change beyond the order and
 * the three numbers (numbers.ts already puts cash needed first for
 * "Funding"):
 *
 *   blocker "Knowing the numbers"   the Full analysis leads, on the card
 *                                   and on the deal sheet, with one line
 *   blocker "Landlord or agent      the sheet leads with Batch 7's first
 *            consent"               message: the next-step card itself on
 *                                   a deal on their My deals, else its
 *                                   opening lines, never the address
 *   next deal "This month"          the daily email marks a deal first seen
 *                                   in the last day "Act fast · new today"
 *   deals wanted in 12 months       nothing on Today (5 a day): the admin
 *                                   page segments by it
 *
 * Pure: no network, no database, no `server-only`.
 */
import { NEXT_STEPS } from '../pipeline/next-steps.ts';
import { messageFields, stepKindOf, type DealFacts as StepFacts } from '../pipeline/facts.ts';
import { fillTemplate } from '../pipeline/render.ts';
import { TAILORING } from './config.ts';
import { realAnswer, usesTailoring, type TailoringProfile } from './profile.ts';

/** What leads the card's buttons and the deal sheet for this member. */
export type Lead = 'analysis' | 'consent' | null;

export function leadFor(p: TailoringProfile | null | undefined): Lead {
  if (!p || !usesTailoring(p) || !realAnswer(p, 'blocker')) return null;
  if (p.about.blocker === 'numbers') return 'analysis';
  if (p.about.blocker === 'consent') return 'consent';
  return null;
}

/** The one line over a card's buttons, and the sheet's Full analysis, for "Knowing the numbers". */
export const ANALYSIS_LEAD_LINE = 'Not sure on the numbers? A Full analysis works them out for this exact property.';

export interface ConsentOpening {
  heading: string;
  /** The Kept stage's own intro for this kind. */
  intro: string;
  /** The message's first paragraphs after the greeting. */
  lines: string[];
}

/**
 * The opening of Batch 7's first message to the agent (the Kept stage's),
 * for a deal that is not yet the member's own on My deals. The address is
 * never filled in, whatever the facts hold: an unopened deal's sheet must
 * not show it, and the full message (with it) is on My deals once opened.
 */
export function consentOpening(facts: StepFacts, now: Date): ConsentOpening | null {
  const kind = stepKindOf(facts.kind);
  if (!kind) return null;
  const block = kind === 'purchase' ? NEXT_STEPS.stages.kept.purchase : NEXT_STEPS.stages.kept.rentToRent;
  if (!block.message) return null;
  const fields = messageFields({ ...facts, address: null }, kind, null, now);
  const paragraphs = fillTemplate(block.message.body, fields)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const body = /^(hello|hi|dear)\b/i.test(paragraphs[0] ?? '') ? paragraphs.slice(1) : paragraphs;
  return { heading: 'Asking for consent', intro: block.intro, lines: body.slice(0, TAILORING.consentOpeningParagraphs) };
}

/** Their next deal is "This month": new deals are worth acting on today. */
export function wantsActFast(p: TailoringProfile | null | undefined): boolean {
  return Boolean(p && realAnswer(p, 'next_deal') && p.about.nextDeal === 'this_month');
}

/** A teaser's title in the daily email, "Act fast · new today · …" when the deal was first seen in the last day. */
export function actFastTitle(title: string, firstSeenAt: string | null | undefined, now: Date): string {
  const seen = firstSeenAt ? Date.parse(firstSeenAt) : NaN;
  if (!Number.isFinite(seen) || now.getTime() - seen > TAILORING.actFastHours * 3_600_000 || seen > now.getTime()) return title;
  return `Act fast · new today · ${title}`;
}
