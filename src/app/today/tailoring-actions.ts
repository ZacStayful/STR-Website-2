'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity/log';
import { isPromptQuestion, promptsFor } from '@/lib/tailoring/behaviour';
import { answerPrompt, currentTailoring, rechooseForMember, saveFilterMode } from '@/lib/tailoring/server';
import { isWidenKey, widenChanges } from '@/lib/tailoring/widen';

/**
 * Today's tailoring actions (Batch 14). Every one checks the session, reads
 * nothing from the form but a key from a closed list, and works out the
 * change itself from the member's own answers: a stale or forged form can
 * only do what Today would have offered them.
 */
async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/today');
  return { supabase, user };
}

/** "Include houses": the prompt's change, worked out again from the member's Keeps, then today's list follows it. */
export async function acceptPromptAction(formData: FormData): Promise<void> {
  const { supabase, user } = await signedIn();
  const question = formData.get('question');
  if (!isPromptQuestion(question)) redirect('/today');
  const now = new Date();
  const current = await currentTailoring(user.id, now);
  const prompt = current ? promptsFor(current.tailoring).find((p) => p.question === question) ?? null : null;
  // No longer called for (answered on another device, the Keeps changed): nothing to do.
  if (!current || !prompt) redirect('/today');
  let goals = current.tailoring.goals;
  if (prompt.change.kind === 'goals') {
    // The live answers, as the member (row policy: their own row only); Batch 13's triggers copy them to the active profile.
    const { error } = await supabase.from('profiles').update({ market_goals: prompt.change.goals, market_goals_updated_at: now.toISOString() }).eq('id', user.id);
    if (error) {
      console.error('[tailoring] prompt answer save failed:', error.message);
      redirect('/today?check=0');
    }
    goals = prompt.change.goals;
  } else {
    const saved = await saveFilterMode(user.id, prompt.change.criterion, 'nice');
    if (!saved.ok) redirect('/today?check=0');
  }
  await answerPrompt(user.id, current.profileId, question, 'accepted', now);
  logActivity(user.id, 'tailoring_prompt', { profileId: current.profileId, extras: { question, step: 'accepted' } });
  await rechooseForMember({ userId: user.id, email: user.email ?? null, goals, now });
  revalidatePath('/today');
  redirect('/today?check=1');
}

/** "Keep flats only": not asked again for 30 days. */
export async function dismissPromptAction(formData: FormData): Promise<void> {
  const { user } = await signedIn();
  const question = formData.get('question');
  if (!isPromptQuestion(question)) redirect('/today');
  const current = await currentTailoring(user.id);
  await answerPrompt(user.id, current?.profileId ?? null, question, 'dismissed');
  logActivity(user.id, 'tailoring_prompt', { profileId: current?.profileId ?? null, extras: { question, step: 'dismissed' } });
  redirect('/today');
}

/** A management company's way to its Leads page, logged on the way. */
export async function leadsUpsellAction(): Promise<void> {
  const { user } = await signedIn();
  logActivity(user.id, 'leads_upsell_clicked');
  redirect('/leads/funnels');
}

/**
 * Widen and see: one of the offered changes, by key. The change itself is
 * worked out again from the member's answers; then today's empty slots are
 * filled (never charged).
 */
export async function applyWidenAction(formData: FormData): Promise<void> {
  const { supabase, user } = await signedIn();
  const key = formData.get('key');
  if (!isWidenKey(key)) redirect('/today');
  const now = new Date();
  const current = await currentTailoring(user.id, now);
  const offer = current ? widenChanges(current.tailoring).find((c) => c.key === key) ?? null : null;
  if (!current || !offer) redirect('/today');
  let goals = current.tailoring.goals;
  if (offer.change.kind === 'goals') {
    const { error } = await supabase.from('profiles').update({ market_goals: offer.change.goals, market_goals_updated_at: now.toISOString() }).eq('id', user.id);
    if (error) {
      console.error('[tailoring] widen save failed:', error.message);
      redirect('/today?check=0');
    }
    goals = offer.change.goals;
  } else {
    const saved = await saveFilterMode(user.id, offer.change.criterion, 'nice');
    if (!saved.ok) redirect('/today?check=0');
  }
  logActivity(user.id, 'tailoring_widen', { profileId: current.profileId, extras: { option: key, step: 'applied' } });
  await rechooseForMember({ userId: user.id, email: user.email ?? null, goals, now });
  revalidatePath('/today');
  redirect('/today?check=1');
}
