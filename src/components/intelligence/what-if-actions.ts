'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { answerQuestion } from '@/lib/profile/server';
import { rechooseForMember } from '@/lib/tailoring/server';
import { isWhatIfKey } from '@/lib/intelligence/what-if';
import { applyWhatIf } from '@/lib/intelligence/what-if-apply-server';

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
  // The one way a what-if is applied (shared with the chat's "Use this", Batch 27).
  const r = await applyWhatIf(user, supabase, key, new Date());
  if (!r.ok) return r;
  return { ok: true, undo: r.undo === null || r.undo === undefined ? null : { questionId: r.questionId, value: r.undo } };
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
