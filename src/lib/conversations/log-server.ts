import 'server-only';

/**
 * Batch 23: the shared conversation log — every conversation with Stayful
 * Intelligence, turn by turn, on any channel (call now, sms now, chat in
 * Batch 26), with each member question and how it went. Batch 24's
 * knowledge base and learning loop read it.
 *
 *   si_conversations           one per conversation (channel, member, persona version)
 *   si_conversation_turns      each member line and agent reply, in order
 *                              (deleted after si_transcript_retention_days)
 *   si_conversation_questions  each question and its outcome (kept)
 *
 * Outcomes on a call are reported live by the agent's log_question tool;
 * the post-call webhook adds a member_unhappy row when ElevenLabs' analysis
 * flags one the agent did not log.
 */
import { createAdminClient } from '../supabase/admin';
import { PERSONA_VERSION } from '../persona/stayful-intelligence';
import type { QuestionOutcome } from '../voice/config';

export type Channel = 'call' | 'sms' | 'chat';

export async function startConversation(o: { channel: Channel; userId: string | null; startedAt?: Date }): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('si_conversations')
    .insert({ channel: o.channel, user_id: o.userId, persona_version: PERSONA_VERSION, started_at: (o.startedAt ?? new Date()).toISOString() })
    .select('id')
    .single();
  if (error) {
    console.error('[conversations] start failed:', error.message);
    return null;
  }
  return String((data as { id: string }).id);
}

export interface Turn {
  role: 'member' | 'agent';
  text: string;
  at?: Date;
  knowledgeRef?: string | null;
}

/** Appends turns after the last one (idempotent per seq: a replay rewrites nothing). */
export async function addTurns(conversationId: string, turns: readonly Turn[], fromSeq = 0): Promise<void> {
  if (turns.length === 0) return;
  const rows = turns.map((t, i) => ({ conversation_id: conversationId, seq: fromSeq + i, role: t.role, text: t.text.slice(0, 4000), at: (t.at ?? new Date()).toISOString(), knowledge_ref: t.knowledgeRef ?? null }));
  const { error } = await createAdminClient().from('si_conversation_turns').upsert(rows, { onConflict: 'conversation_id,seq', ignoreDuplicates: true });
  if (error) console.error('[conversations] turns failed:', error.message);
}

export async function recordQuestion(conversationId: string, q: { question: string; outcome: QuestionOutcome; knowledgeRef?: string | null; source?: 'tool' | 'analysis' | 'sms' | 'chat' }): Promise<void> {
  const question = q.question.trim().slice(0, 500);
  if (!question) return;
  const { error } = await createAdminClient().from('si_conversation_questions').insert({ conversation_id: conversationId, question, outcome: q.outcome, knowledge_ref: q.knowledgeRef ?? null, source: q.source ?? 'tool' });
  if (error) console.error('[conversations] question failed:', error.message);
}

export async function hasOutcome(conversationId: string, outcome: QuestionOutcome): Promise<boolean> {
  const { data, error } = await createAdminClient().from('si_conversation_questions').select('id').eq('conversation_id', conversationId).eq('outcome', outcome).limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

export async function closeConversation(conversationId: string, endedAt: Date = new Date()): Promise<void> {
  const { error } = await createAdminClient().from('si_conversations').update({ ended_at: endedAt.toISOString() }).eq('id', conversationId).is('ended_at', null);
  if (error) console.error('[conversations] close failed:', error.message);
}
