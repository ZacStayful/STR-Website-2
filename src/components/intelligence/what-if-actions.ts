'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { answerQuestion } from '@/lib/profile/server';
import { rechooseForMember } from '@/lib/tailoring/server';
import { logActivity } from '@/lib/activity/log';
import { intelligenceMember } from '@/lib/intelligence/view-server';
import { isWhatIfKey, whatIfAnswer, whatIfChanges } from '@/lib/intelligence/what-if';
import { nearestAreas, referencePoint } from '@/lib/today/candidates';
import { WHAT_IF_NEARBY_AREAS } from '@/lib/intelligence/config';

export type WhatIfActionResult = { ok: true; undo: { questionId: string; value: unknown } | null } | { ok: false; error: string };

/**
 * Batch 22, Part F: "Use this". Only the key comes from the page; the change
 * is worked out again from the member's own answers, so a stale or forged
 * form can only make a change the page would have offered. Saved through the
 * quiz (profile_edited), then today's list is chosen again with it.
 */
export async function applyWhatIfAction(key: unknown): Promise<WhatIfActionResult> {
  if (!isWhatIfKey(key)) return { ok: false, error: 'That suggestion has changed. Please reload.' };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  const now = new Date();
  // Answers are the active profile's: the header view's member.
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
  return { ok: true, undo: answer.undo === null || answer.undo === undefined ? null : { questionId: answer.questionId, value: answer.undo } };
}

/** "Undo": the answer as it was, through the quiz again. */
export async function undoWhatIfAction(undo: { questionId: unknown; value: unknown }): Promise<WhatIfActionResult> {
  const allowed = ['max_rent', 'where', 'bedrooms', 'property_type', 'min_profit', 'r2r_min_profit', 'deal_types'];
  if (typeof undo?.questionId !== 'string' || !allowed.includes(undo.questionId)) return { ok: false, error: 'Nothing to undo.' };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Please sign in again.' };
  const now = new Date();
  const r = await answerQuestion({ userId: user.id, email: user.email ?? null, supabase, questionId: undo.questionId, value: undo.value, notSure: false, editing: true });
  if (!r.ok) return { ok: false, error: r.error };
  await rechooseForMember({ userId: user.id, email: user.email ?? null, now, answeredAt: now.toISOString() });
  return { ok: true, undo: null };
}
