import 'server-only';

/**
 * Batch 26: the chat's one way into the knowledge base, as Batch 24's README
 * ("For Batches 25 and 26") sets out: the live (approved) entries allowed on
 * the chat, matched with matchKnowledge at Batch 24's thresholds, and only an
 * `answered` match rendered for this member now. Below the threshold the chat
 * has no approved answer, and says "I don't know that one yet". A draft can
 * never reach here: liveEntries reads si_knowledge_live, which has none.
 */
import { liveEntries, readGlobalSnapshot, readKnowledgeSettings } from '../knowledge/store-server';
import { matchKnowledge, type MatchOutcome } from '../knowledge/match';
import { renderEntry } from '../knowledge/render';
import type { MemberValues } from '../knowledge/placeholders';
import type { createAdminClient } from '../supabase/admin';

export interface KnownAnswer {
  slug: string;
  question: string;
  answer: string;
  confidence: number;
}

export interface KnowledgeLookup {
  /** The matcher's verdict on the question. */
  outcome: MatchOutcome;
  /** The approved answer(s) to give, rendered now; empty unless the outcome is answered. */
  answers: KnownAnswer[];
  /** The best confidence seen, for the admin examples either side of the threshold. */
  topConfidence: number;
}

/** The chat's approved entries, the thresholds and the global figures: read once, ahead of the member's own. */
export interface LoadedKnowledge {
  entries: Awaited<ReturnType<typeof liveEntries>>;
  settings: Awaited<ReturnType<typeof readKnowledgeSettings>>;
  global: Awaited<ReturnType<typeof readGlobalSnapshot>>;
}

export async function loadKnowledge(admin?: ReturnType<typeof createAdminClient>): Promise<LoadedKnowledge> {
  const [entries, settings, global] = await Promise.all([liveEntries('chat', admin), readKnowledgeSettings(admin), readGlobalSnapshot(admin)]);
  return { entries, settings, global };
}

/** Pass `loaded` when it was read alongside the member's context (quick answers do), so the two reads overlap. */
export async function lookUpKnowledge(question: string, values: MemberValues | null, admin?: ReturnType<typeof createAdminClient>, loaded?: LoadedKnowledge): Promise<KnowledgeLookup> {
  const { entries, settings, global } = loaded ?? (await loadKnowledge(admin));
  if (!entries || entries.length === 0) return { outcome: 'could_not_answer', answers: [], topConfidence: 0 };
  const match = matchKnowledge(entries, question, { answerMin: settings.answerMinConfidence, lowMin: settings.lowConfidenceMin, channel: 'chat', limit: 3 });
  const topConfidence = match.matches[0]?.confidence ?? 0;
  if (match.outcome !== 'answered') return { outcome: match.outcome, answers: [], topConfidence };
  const top = match.matches[0];
  const entry = entries.find((e) => e.id === top.entryId);
  if (!entry) return { outcome: 'could_not_answer', answers: [], topConfidence };
  const r = renderEntry(entry, global, values);
  // Hidden, skipped (a member value it needs isn't known), stale or unreadable: no approved answer to give.
  if (r.kind !== 'ok') return { outcome: 'low_confidence', answers: [], topConfidence };
  return { outcome: 'answered', answers: [{ slug: entry.slug, question: r.question, answer: r.answer, confidence: top.confidence }], topConfidence };
}
