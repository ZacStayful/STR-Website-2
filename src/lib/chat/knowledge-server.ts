import 'server-only';

/**
 * Batch 26: the chat's one way into the knowledge base, as Batch 24's README
 * ("For Batches 25 and 26") sets out: the live (approved) entries allowed on
 * the chat, matched with matchKnowledge at Batch 24's thresholds, and only an
 * `answered` match rendered for this member now (Review R3, R3-33: the next
 * match above the threshold when the top one doesn't apply to this member;
 * `hidden` when none does, so the question still counts as covered). Below
 * the threshold the chat has no approved answer, and says "I don't know that
 * one yet". A draft can never reach here: liveEntries reads
 * si_knowledge_live, which has none.
 */
import { liveEntries, readGlobalSnapshot, readKnowledgeSettings } from '../knowledge/store-server';
import { matchKnowledge } from '../knowledge/match';
import { renderEntry } from '../knowledge/render';
import type { MemberValues } from '../knowledge/placeholders';
import type { createAdminClient } from '../supabase/admin';
import { chooseAnswer, NO_LOOKUP, type KnowledgeLookup } from './knowledge';

export type { KnownAnswer, KnowledgeLookup } from './knowledge';

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
  if (!entries || entries.length === 0) return NO_LOOKUP;
  const match = matchKnowledge(entries, question, { answerMin: settings.answerMinConfidence, lowMin: settings.lowConfidenceMin, channel: 'chat', limit: 3 });
  return chooseAnswer(match, entries, settings.answerMinConfidence, (e) => renderEntry(e, global, values));
}
