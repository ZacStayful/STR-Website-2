/**
 * Review R3 (R3-33): which approved answer the chat gives for a matched
 * question, once each candidate is rendered for this member.
 *
 * The matcher's verdict says the top entry answers the question; rendering
 * it for the member may still say "not for them" (a show_when that is false
 * for this account, or a value they don't have). Then the next match at or
 * above the answer threshold is tried. When every candidate is hidden or
 * skipped, the question IS covered: the outcome stays 'answered', with the
 * entry as `hidden` and no text, so the caller can say it doesn't apply to
 * this account and log the slug (the nightly job then never drafts a gap
 * for a question the knowledge base already answers). An entry that no
 * longer renders at all (stale, unavailable) is passed over.
 *
 * Pure.
 */
import type { MatchOutcome, MatchResult } from '../knowledge/match.ts';
import type { RenderResult } from '../knowledge/render.ts';

export interface KnownAnswer {
  slug: string;
  question: string;
  answer: string;
  confidence: number;
}

export interface KnowledgeLookup {
  /** The matcher's verdict on the question ('answered' with no answers: covered, but not for this member). */
  outcome: MatchOutcome;
  /** The approved answer(s) to give, rendered now; empty unless the outcome is answered. */
  answers: KnownAnswer[];
  /** The best confidence seen, for the admin examples either side of the threshold. */
  topConfidence: number;
  /** An approved entry that answers the question but doesn't apply to this member, when no other does. */
  hidden: string | null;
}

export const NO_LOOKUP: KnowledgeLookup = { outcome: 'could_not_answer', answers: [], topConfidence: 0, hidden: null };

export function chooseAnswer<E extends { id: string; slug: string }>(match: MatchResult, entries: readonly E[], answerMin: number, render: (e: E) => RenderResult): KnowledgeLookup {
  const topConfidence = match.matches[0]?.confidence ?? 0;
  if (match.outcome !== 'answered') return { outcome: match.outcome, answers: [], topConfidence, hidden: null };
  let hidden: string | null = null;
  for (const m of match.matches) {
    if (m.confidence < answerMin) break;
    const entry = entries.find((e) => e.id === m.entryId);
    if (!entry) continue;
    const r = render(entry);
    if (r.kind === 'ok') return { outcome: 'answered', answers: [{ slug: entry.slug, question: r.question, answer: r.answer, confidence: m.confidence }], topConfidence, hidden: null };
    if ((r.kind === 'hidden' || r.kind === 'skip') && !hidden) hidden = entry.slug;
  }
  return hidden ? { outcome: 'answered', answers: [], topConfidence, hidden } : { outcome: 'low_confidence', answers: [], topConfidence, hidden: null };
}
