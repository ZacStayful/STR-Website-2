import 'server-only';

/**
 * Batch 26: the chat's side of Batch 23's conversation log.
 *
 * Every question and answer is written there (channel 'chat', source 'chat',
 * the approved answer's slug as knowledge_ref), which is what Coverage counts
 * and what Batch 24's nightly job learns from. A quick answer is its own
 * conversation; the full view keeps one going until it has been quiet for
 * si_chat_session_idle_minutes.
 *
 * Members see their own chat for si_transcript_retention_days (Batch 23's
 * 90) and can delete it. Deleting, and the 90 days running out, leave the
 * question and its outcome for learning, with no name on them (Zac, 29 Sep):
 * the transcript is deleted (purgeTranscripts already does that at 90 days
 * for every channel) and user_id is cleared on the conversation and on
 * chat_turns.
 */
import { createAdminClient } from '../supabase/admin';
import { addTurns, closeConversation, recordQuestion, startConversation, type Turn } from '../conversations/log-server';
import { rememberFact, type RememberResult } from '../knowledge/facts-server';
import type { QuestionOutcome } from '../voice/config';
import { isUuid, type ChatMember, type FactProposal, type TurnRow } from './turns-server';
import type { ChatSurface } from './config';
import { stateReply, type ChatReply } from './reply';
import { chargeLabel } from './format';

export type Admin = ReturnType<typeof createAdminClient>;

export interface PriorTurn {
  role: 'member' | 'agent';
  text: string;
}

export interface OpenConversation {
  id: string;
  /** The seq the next turn takes. */
  nextSeq: number;
  /** The conversation so far, oldest first (full view only; empty for a new one). */
  history: PriorTurn[];
}

/**
 * The conversation a question belongs to. A quick answer always starts its
 * own. The full view continues the one the page holds when it is this
 * member's, still has its transcript and was used within the idle window;
 * otherwise that one is closed and a new one starts.
 */
export async function openConversation(admin: Admin, member: ChatMember, surface: ChatSurface, requestedId: unknown, o: { idleMinutes: number; historyTurns: number; now: Date }): Promise<OpenConversation | null> {
  if (surface === 'full' && isUuid(requestedId)) {
    const { data: conv } = await admin.from('si_conversations').select('id, started_at, ended_at, transcript_purged_at').eq('id', requestedId).eq('channel', 'chat').eq('user_id', member.userId).maybeSingle();
    if (conv && !conv.ended_at && !conv.transcript_purged_at) {
      const { data: turns } = await admin.from('si_conversation_turns').select('seq, role, text, at').eq('conversation_id', requestedId).order('seq', { ascending: false }).limit(Math.max(2, o.historyTurns * 2));
      const rows = ((turns ?? []) as { seq: number; role: 'member' | 'agent'; text: string; at: string }[]).reverse();
      const lastAt = rows.length > 0 ? Date.parse(rows[rows.length - 1].at) : Date.parse(String(conv.started_at));
      if (Number.isFinite(lastAt) && o.now.getTime() - lastAt <= o.idleMinutes * 60_000) {
        const nextSeq = rows.length > 0 ? rows[rows.length - 1].seq + 1 : 0;
        return { id: requestedId, nextSeq, history: o.historyTurns > 0 ? rows.map((r) => ({ role: r.role, text: r.text })) : [] };
      }
      await closeConversation(requestedId, o.now);
    }
  }
  const id = await startConversation({ channel: 'chat', userId: member.userId, startedAt: o.now });
  return id ? { id, nextSeq: 0, history: [] } : null;
}

/**
 * The question and its answer into the log, with the outcome. Returns the
 * question's id and the answer's seq (kept on chat_turns for "Not helpful"
 * and for giving a reconnect the stored answer back).
 */
export async function logExchange(conv: OpenConversation, x: { question: string; answer: string | null; outcome: QuestionOutcome; knowledgeRef: string | null; surface: ChatSurface; at: Date }): Promise<{ questionId: string | null; agentSeq: number | null }> {
  const turns: Turn[] = [{ role: 'member', text: x.question, at: x.at }];
  if (x.answer) turns.push({ role: 'agent', text: x.answer, at: new Date(), knowledgeRef: x.knowledgeRef });
  await addTurns(conv.id, turns, conv.nextSeq);
  const questionId = await recordQuestion(conv.id, { question: x.question, outcome: x.outcome, knowledgeRef: x.knowledgeRef, source: 'chat' });
  if (x.surface === 'quick') await closeConversation(conv.id);
  return { questionId, agentSeq: x.answer ? conv.nextSeq + 1 : null };
}

/** The answer a settled question gave, from the log (a reconnect's copy). Null once deleted. */
export async function storedAnswer(admin: Admin, turn: TurnRow): Promise<string | null> {
  if (!turn.conversation_id || turn.log_seq === null) return null;
  const { data } = await admin.from('si_conversation_turns').select('text').eq('conversation_id', turn.conversation_id).eq('seq', turn.log_seq).maybeSingle();
  return (data?.text as string | undefined) ?? null;
}

/**
 * What a retry or reconnect with the same client id gets: the first result,
 * never a second model call or charge. A question that failed part-way is
 * "didn't finish — ask again" (a new send, a new id), never a free copy of an
 * answer that wasn't delivered.
 */
export async function replyForStored(admin: Admin, turn: TurnRow, member: ChatMember): Promise<ChatReply> {
  if (turn.status === 'pending') return stateReply('busy', { turnId: turn.id });
  if (turn.status === 'failed') return stateReply('did_not_finish', { turnId: turn.id });
  if (turn.status === 'no_answer') {
    const fullView = turn.surface === 'quick' && turn.outcome === 'low_confidence' && (turn.buttons ?? []).some((b) => b.kind === 'open_full_view');
    return { ...stateReply(fullView ? 'full_view' : 'unknown', { turnId: turn.id, teamMember: member.teamMember }), buttons: turn.buttons ?? [], conversationId: turn.conversation_id };
  }
  const text = await storedAnswer(admin, turn);
  if (!text) return stateReply('did_not_finish', { turnId: turn.id });
  return {
    state: 'answer',
    turnId: turn.id,
    text,
    buttons: turn.buttons ?? [],
    charged: turn.charged_face_pence > 0 ? chargeLabel(turn.charged_face_pence) : null,
    conversationId: turn.conversation_id,
    factProposal: turn.fact_proposal && !turn.fact_proposal.answered ? turn.fact_proposal.fact : null,
    capped: turn.capped,
  };
}

// ── The member's own history ────────────────────────────────────────────────

export interface HistoryConversation {
  id: string;
  startedAt: string;
  turns: { role: 'member' | 'agent'; text: string; at: string }[];
}

/** The member's own chat in the retention window, newest conversation first. */
export async function memberHistory(admin: Admin, userId: string, o: { days: number; now: Date; limit?: number }): Promise<HistoryConversation[]> {
  const since = new Date(o.now.getTime() - o.days * 24 * 60 * 60 * 1000).toISOString();
  const { data: convs, error } = await admin
    .from('si_conversations')
    .select('id, started_at')
    .eq('channel', 'chat')
    .eq('user_id', userId)
    .is('transcript_purged_at', null)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(o.limit ?? 30);
  if (error) throw new Error(`chat history: ${error.message}`);
  const ids = ((convs ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: turns, error: tErr } = await admin.from('si_conversation_turns').select('conversation_id, seq, role, text, at').in('conversation_id', ids).order('seq', { ascending: true });
  if (tErr) throw new Error(`chat history turns: ${tErr.message}`);
  const by = new Map<string, HistoryConversation['turns']>();
  for (const t of (turns ?? []) as { conversation_id: string; role: 'member' | 'agent'; text: string; at: string }[]) {
    const list = by.get(t.conversation_id) ?? [];
    list.push({ role: t.role, text: t.text, at: t.at });
    by.set(t.conversation_id, list);
  }
  return ((convs ?? []) as { id: string; started_at: string }[]).map((c) => ({ id: c.id, startedAt: c.started_at, turns: by.get(c.id) ?? [] })).filter((c) => c.turns.length > 0);
}

/**
 * "Delete my chat history": every chat transcript of this member is
 * deleted, and their name comes off the conversations and the questions'
 * rows. The questions and how they went stay, unnamed, for learning.
 */
export async function deleteMemberHistory(admin: Admin, userId: string, now: Date = new Date()): Promise<{ conversations: number }> {
  const { data: convs, error } = await admin.from('si_conversations').select('id').eq('channel', 'chat').eq('user_id', userId);
  if (error) throw new Error(`chat delete: ${error.message}`);
  const ids = ((convs ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length > 0) {
    const del = await admin.from('si_conversation_turns').delete().in('conversation_id', ids);
    if (del.error) throw new Error(`chat delete turns: ${del.error.message}`);
    const anon = await admin.from('si_conversations').update({ user_id: null, transcript_purged_at: now.toISOString(), ended_at: now.toISOString() }).in('id', ids);
    if (anon.error) throw new Error(`chat delete conversations: ${anon.error.message}`);
  }
  const turns = await admin.from('chat_turns').update({ user_id: null, payer_id: null, fact_proposal: null, buttons: null, anonymised_at: now.toISOString() }).eq('user_id', userId).neq('status', 'pending');
  if (turns.error) throw new Error(`chat delete turns: ${turns.error.message}`);
  return { conversations: ids.length };
}

/**
 * The 90-day rule for chat: past si_transcript_retention_days, the name
 * comes off. (purgeTranscripts, Batch 23, deletes the text for every
 * channel.) A dry run only counts.
 */
export async function anonymiseChat(o: { apply: boolean; days: number; now?: Date; limit?: number }): Promise<{ conversations: number; turns: number }> {
  const admin = createAdminClient();
  const now = o.now ?? new Date();
  const days = Math.max(1, Math.floor(o.days));
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const limit = o.limit ?? 1000;
  const convs = await admin.from('si_conversations').select('id').eq('channel', 'chat').not('user_id', 'is', null).lt('started_at', cutoff).limit(limit);
  if (convs.error) throw new Error(`chat retention: ${convs.error.message}`);
  const turns = await admin.from('chat_turns').select('id').not('user_id', 'is', null).lt('created_at', cutoff).neq('status', 'pending').limit(limit);
  if (turns.error) throw new Error(`chat retention: ${turns.error.message}`);
  const convIds = ((convs.data ?? []) as { id: string }[]).map((r) => r.id);
  const turnIds = ((turns.data ?? []) as { id: string }[]).map((r) => r.id);
  if (o.apply) {
    if (convIds.length > 0) {
      const u = await admin.from('si_conversations').update({ user_id: null }).in('id', convIds);
      if (u.error) throw new Error(`chat retention: ${u.error.message}`);
    }
    if (turnIds.length > 0) {
      const u = await admin.from('chat_turns').update({ user_id: null, payer_id: null, fact_proposal: null, buttons: null, anonymised_at: now.toISOString() }).in('id', turnIds);
      if (u.error) throw new Error(`chat retention: ${u.error.message}`);
    }
  }
  return { conversations: convIds.length, turns: turnIds.length };
}

// ── After an answer: "Not helpful" and "Want me to remember that?" ──────────

/** "Not helpful": the question is logged again as member_unhappy (once), for the nightly job to learn from. No refund. */
export async function markUnhappy(admin: Admin, userId: string, turnId: string): Promise<boolean> {
  if (!isUuid(turnId)) return false;
  const { data } = await admin.from('chat_turns').update({ outcome: 'member_unhappy' }).eq('id', turnId).eq('user_id', userId).eq('status', 'answered').neq('outcome', 'member_unhappy').select('conversation_id, question_id, knowledge_slug');
  const row = ((data ?? []) as { conversation_id: string | null; question_id: string | null; knowledge_slug: string | null }[])[0];
  if (!row?.conversation_id || !row.question_id) return Boolean(row);
  const { data: q } = await admin.from('si_conversation_questions').select('question').eq('id', row.question_id).maybeSingle();
  if (q?.question) await recordQuestion(row.conversation_id, { question: String(q.question), outcome: 'member_unhappy', knowledgeRef: row.knowledge_slug, source: 'chat' });
  return true;
}

export type FactAnswer = { ok: true; saved: boolean } | { ok: false; reason: Extract<RememberResult, { ok: false }>['reason'] };

/**
 * The member's Yes or No to "Want me to remember that?". Only the fact the
 * answer proposed, only once, only theirs; a Yes goes through Batch 24's
 * rememberFact (which refuses sensitive or personal details, duplicates and
 * the cap). A No saves nothing.
 */
export async function answerFact(admin: Admin, member: ChatMember, turnId: string, yes: boolean): Promise<FactAnswer | null> {
  if (!isUuid(turnId)) return null;
  const { data } = await admin.from('chat_turns').select('fact_proposal, conversation_id').eq('id', turnId).eq('user_id', member.userId).maybeSingle();
  const proposal = (data?.fact_proposal ?? null) as FactProposal | null;
  if (!proposal || proposal.answered) return null;
  // Claim the answer first: a double tap can't save twice.
  const claimed = await admin.from('chat_turns').update({ fact_proposal: { ...proposal, answered: yes ? 'yes' : 'no' } }).eq('id', turnId).eq('user_id', member.userId).is('fact_proposal->>answered', null).select('id');
  if ((claimed.data ?? []).length === 0) return null;
  if (!yes) return { ok: true, saved: false };
  const result = await rememberFact({ userId: member.userId, fact: proposal.fact, asked: proposal.asked, confirmed: true, channel: 'chat', confirmedVia: 'chat_yes', conversationId: (data?.conversation_id as string | null) ?? null });
  await admin.from('chat_turns').update({ fact_proposal: { ...proposal, answered: 'yes', saved: result.ok } }).eq('id', turnId);
  return result.ok ? { ok: true, saved: true } : { ok: false, reason: result.reason };
}
