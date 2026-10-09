import 'server-only';

/**
 * Batch 26: what /admin/intelligence/chat shows. Counts and money from
 * chat_turns (no text), the questions themselves from Batch 23's log
 * (source 'chat'; never a member's name), and weekly active from the
 * activity log. Never throws: a read that fails says so.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { QUALIFYING_KINDS } from '../activity/kinds';
import { recentWeeks, ukWeekStart, ukWeekRange } from '../activity/week';
import { readKnowledgeSettings } from '../knowledge/store-server';
import { readChatSettings } from './turns-server';
import { activeShare, money, outcomes, perDay, type DayCount, type Money, type Outcomes, type TurnFact, type WeekActive } from './metrics';
import type { ChatSettings } from './settings';
import type { ChatSurface } from './config';

export const ADMIN_DAYS = 30;
export const ADMIN_WEEKS = 4;
const ROW_LIMIT = 10_000;

export interface TopQuestion {
  question: string;
  asked: number;
  answered: number;
  notAnswered: number;
}

export interface NearMiss {
  question: string;
  confidence: number;
  outcome: string | null;
  surface: ChatSurface;
}

export interface ChatAdmin {
  settings: ChatSettings;
  answerMin: number;
  envOn: boolean;
  days: DayCount[];
  outcomes: Record<ChatSurface, Outcomes>;
  money: Record<ChatSurface | 'all', Money>;
  topQuestions: TopQuestion[];
  above: NearMiss[];
  below: NearMiss[];
  active: WeekActive[];
}

export type ChatAdminLoad = { status: 'ok'; data: ChatAdmin } | { status: 'no_service_role' } | { status: 'failed'; message: string };

export async function loadChatAdmin(now: Date = new Date()): Promise<ChatAdminLoad> {
  if (!hasServiceRole()) return { status: 'no_service_role' };
  try {
    const admin = createAdminClient();
    const since = new Date(now.getTime() - ADMIN_DAYS * 86_400_000).toISOString();
    const [settings, ks, turnsRes, questionsRes] = await Promise.all([
      readChatSettings(admin),
      readKnowledgeSettings(admin),
      admin
        .from('chat_turns')
        .select('user_id, created_at, surface, status, outcome, raw_pence, charged_base_pence, charged_face_pence, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, match_confidence, question_id')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      admin.from('si_conversation_questions').select('question, outcome').eq('source', 'chat').gte('at', since).limit(ROW_LIMIT),
    ]);
    if (turnsRes.error) return { status: 'failed', message: `chat_turns: ${turnsRes.error.message}` };
    type Raw = { user_id: string | null; created_at: string; surface: ChatSurface; status: TurnFact['status']; outcome: string | null; raw_pence: number; charged_base_pence: number; charged_face_pence: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; match_confidence: number | null; question_id: string | null };
    const raw = (turnsRes.data ?? []) as Raw[];
    const facts: (TurnFact & { userId: string | null })[] = raw.map((r) => ({
      userId: r.user_id,
      createdAt: r.created_at,
      surface: r.surface,
      status: r.status,
      outcome: r.outcome,
      rawPence: Number(r.raw_pence) || 0,
      chargedBasePence: Number(r.charged_base_pence) || 0,
      chargedFacePence: Number(r.charged_face_pence) || 0,
      inputTokens: Number(r.input_tokens) || 0,
      outputTokens: Number(r.output_tokens) || 0,
      cacheReadTokens: Number(r.cache_read_tokens) || 0,
      cacheWriteTokens: Number(r.cache_write_tokens) || 0,
    }));
    const of = (s: ChatSurface) => facts.filter((f) => f.surface === s);

    // The most asked questions (the log's own text, lower-cased to group).
    const groups = new Map<string, TopQuestion>();
    for (const q of (questionsRes.data ?? []) as { question: string; outcome: string }[]) {
      if (q.outcome === 'member_unhappy') continue;
      const k = q.question.trim().toLowerCase().replace(/[?.!]+$/, '');
      const g = groups.get(k) ?? { question: q.question.trim(), asked: 0, answered: 0, notAnswered: 0 };
      g.asked += 1;
      if (q.outcome === 'answered') g.answered += 1;
      else g.notAnswered += 1;
      groups.set(k, g);
    }
    const topQuestions = [...groups.values()].sort((a, b) => b.asked - a.asked || a.question.localeCompare(b.question)).slice(0, 15);

    // Five real questions either side of the answered threshold.
    const scored = raw.filter((r) => r.match_confidence !== null && r.question_id);
    const above = scored.filter((r) => Number(r.match_confidence) >= ks.answerMinConfidence).sort((a, b) => Number(a.match_confidence) - Number(b.match_confidence)).slice(0, 5);
    const below = scored.filter((r) => Number(r.match_confidence) < ks.answerMinConfidence).sort((a, b) => Number(b.match_confidence) - Number(a.match_confidence)).slice(0, 5);
    const ids = [...above, ...below].map((r) => r.question_id!) ;
    const texts = new Map<string, string>();
    if (ids.length > 0) {
      const { data } = await admin.from('si_conversation_questions').select('id, question').in('id', ids);
      for (const q of (data ?? []) as { id: string; question: string }[]) texts.set(q.id, q.question);
    }
    const near = (r: Raw): NearMiss => ({ question: texts.get(r.question_id!) ?? '(deleted)', confidence: Number(r.match_confidence), outcome: r.outcome, surface: r.surface });

    // Weekly active among chat users, the last few UK weeks.
    const weeks = recentWeeks(now, ADMIN_WEEKS);
    const chatUsers = new Map<string, Set<string>>();
    for (const f of facts) {
      if (!f.userId) continue;
      const w = ukWeekStart(new Date(f.createdAt));
      if (!weeks.includes(w)) continue;
      const set = chatUsers.get(w) ?? new Set<string>();
      set.add(f.userId);
      chatUsers.set(w, set);
    }
    const everyone = [...new Set([...chatUsers.values()].flatMap((s) => [...s]))];
    const qualifying = new Map<string, Map<string, Set<string>>>();
    if (everyone.length > 0) {
      const from = ukWeekRange(weeks[0]).start.toISOString();
      for (let i = 0; i < everyone.length; i += 200) {
        const { data } = await admin.from('activity_events').select('user_id, kind, occurred_at').in('user_id', everyone.slice(i, i + 200)).in('kind', QUALIFYING_KINDS as string[]).gte('occurred_at', from).limit(ROW_LIMIT);
        for (const e of (data ?? []) as { user_id: string; kind: string; occurred_at: string }[]) {
          const w = ukWeekStart(new Date(e.occurred_at));
          const byUser = qualifying.get(w) ?? new Map<string, Set<string>>();
          const kinds = byUser.get(e.user_id) ?? new Set<string>();
          kinds.add(e.kind);
          byUser.set(e.user_id, kinds);
          qualifying.set(w, byUser);
        }
      }
    }

    return {
      status: 'ok',
      data: {
        settings,
        answerMin: ks.answerMinConfidence,
        envOn: process.env.SI_CHAT_ENABLED === 'true',
        days: perDay(facts, ADMIN_DAYS, now),
        outcomes: { quick: outcomes(of('quick')), full: outcomes(of('full')) },
        money: { quick: money(of('quick')), full: money(of('full')), all: money(facts) },
        topQuestions,
        above: above.map(near),
        below: below.map(near),
        active: activeShare([...weeks].reverse(), chatUsers, qualifying, 'si_chat_full'),
      },
    };
  } catch (err) {
    return { status: 'failed', message: (err as Error)?.message ?? 'failed' };
  }
}
