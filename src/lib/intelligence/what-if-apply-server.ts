import 'server-only';

/**
 * Batch 22, Part F's "Use this", as one server function: the Stayful
 * Intelligence view's button (src/components/intelligence/what-if-actions.ts)
 * and, from Batch 27, the chat's own "Use this" (which adds a 24-hour Undo)
 * both apply a what-if through here.
 *
 * Only the key comes from the page; the change is worked out again from the
 * member's own answers (the active profile: the header view's member), so a
 * stale or forged form can only make a change the page would have offered.
 * Saved through the quiz (profile_edited), then today's list is chosen again.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { answerQuestion } from '../profile/server';
import { rechooseForMember } from '../tailoring/server';
import { logActivity } from '../activity/log';
import { intelligenceMember } from './view-server';
import { isWhatIfKey, whatIfAnswer, whatIfChanges } from './what-if';
import { nearestAreas, referencePoint } from '../today/candidates';
import { WHAT_IF_NEARBY_AREAS } from './config';

export type WhatIfApplied = { ok: true; questionId: string; value: unknown; undo: unknown; matchCount: number | null } | { ok: false; error: string };

export async function applyWhatIf(user: Pick<User, 'id' | 'email'>, supabase: SupabaseClient, key: unknown, now: Date = new Date()): Promise<WhatIfApplied> {
  if (!isWhatIfKey(key)) return { ok: false, error: 'That suggestion has changed. Please reload.' };
  const { member } = await intelligenceMember(user, 'header', now);
  if (!member.tailoring || !member.goals) return { ok: false, error: 'That suggestion isn’t available right now.' };
  const nearby = member.goals.where === 'near' ? [] : nearestAreas(referencePoint(member.goals, member.savedAreas), new Set(member.savedAreas), WHAT_IF_NEARBY_AREAS);
  const v = whatIfChanges(member.tailoring, { nearbyAreas: nearby }).find((x) => x.key === key);
  const answer = v ? whatIfAnswer(v, { goals: member.goals, savedAreas: member.savedAreas }) : null;
  if (!v || !answer) return { ok: false, error: 'That suggestion has changed. Please reload.' };
  const r = await answerQuestion({ userId: user.id, email: user.email ?? null, supabase, questionId: answer.questionId, value: answer.value, notSure: false, editing: true });
  if (!r.ok) return { ok: false, error: r.error };
  logActivity(user.id, 'si_view', { extras: { surface: 'reveal', step: 'show_me', use: key } });
  await rechooseForMember({ userId: user.id, email: user.email ?? null, now, answeredAt: now.toISOString() });
  return { ok: true, questionId: answer.questionId, value: answer.value, undo: answer.undo ?? null, matchCount: r.view.matchCount };
}
