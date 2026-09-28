'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseMarketGoals, type Priority } from '@/lib/market/goals';
import { profileSummaryFor } from '@/lib/profile/server';
import { logActivity } from '@/lib/activity/log';
import { GOALS_EDITOR_HREF } from '@/lib/nav';
import { isSwitchable } from '@/lib/tailoring/profile';
import { rechooseForMember, saveFilterMode } from '@/lib/tailoring/server';

/**
 * The profile page's "Advanced" answers: the four ranking priorities, the
 * motivated-seller thresholds, the mortgage term and the target yield — the
 * goals the Explorer's panel used to edit and the quiz does not ask. Merged
 * into the stored goals (never rebuilt from the form), written as the member.
 */
export async function saveAdvancedAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/profile');
  const s = await profileSummaryFor(user.id);
  if (!s) redirect(GOALS_EDITOR_HREF);

  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : null;
  };
  const priority = (k: string, fallback: Priority): Priority => {
    const n = Number(get(k));
    return n === 0 || n === 1 || n === 2 || n === 3 ? n : fallback;
  };
  const g = s.answers.goals;
  const mode = get('m_mode');
  const next = parseMarketGoals({
    ...g,
    priorities: { yield: priority('p_yield', g.priorities.yield), revenue: priority('p_revenue', g.priorities.revenue), lowCompetition: priority('p_lowCompetition', g.priorities.lowCompetition), directBookings: priority('p_directBookings', g.priorities.directBookings) },
    finance: { ...g.finance, termYears: get('f_termYears') ?? g.finance.termYears, targetYieldPct: get('f_targetYieldPct') ?? g.finance.targetYieldPct },
    motivation: {
      ...g.motivation,
      mode: mode === 'off' || mode === 'prefer' || mode === 'only' ? mode : g.motivation.mode,
      minMonthsOnMarket: get('m_minMonths') ?? g.motivation.minMonthsOnMarket,
      minWeeksOnMarket: get('m_minWeeks') ?? g.motivation.minWeeksOnMarket,
      // An unchecked box posts nothing, so absent means off here.
      areaRelative: get('m_areaRelative') === '1',
    },
  });
  if (!next) redirect(`${GOALS_EDITOR_HREF}?saved=0`);

  const { error } = await supabase.from('profiles').update({ market_goals: next, market_goals_updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) {
    console.error('[profile] advanced save failed:', error.message);
    redirect(`${GOALS_EDITOR_HREF}?saved=0`);
  }
  logActivity(user.id, 'profile_edited', { extras: { question: 'advanced', section: 'advanced' } });
  // Batch 14: today's list follows at once (motivated sellers may be a must-have now).
  await rechooseForMember({ userId: user.id, email: user.email ?? null, goals: next });
  revalidatePath(GOALS_EDITOR_HREF);
  revalidatePath('/markets');
  redirect(`${GOALS_EDITOR_HREF}?saved=1#advanced`);
}

/**
 * Batch 14: one answer's Must-have / Nice-to-have switch on the active
 * profile. The criterion is checked against the closed list; the mode is one
 * of two words; nothing else is read from the form. Today's list for the
 * profile is chosen again at once (never charged).
 */
export async function setFilterModeAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/profile');
  const criterion = formData.get('criterion');
  const mode = formData.get('mode');
  const back = typeof formData.get('question') === 'string' ? `#q-${String(formData.get('question')).replace(/[^a-z_]/g, '')}` : '';
  if (!isSwitchable(criterion) || (mode !== 'must' && mode !== 'nice')) redirect(`${GOALS_EDITOR_HREF}?mode=0`);
  const saved = await saveFilterMode(user.id, criterion, mode);
  if (!saved.ok) redirect(`${GOALS_EDITOR_HREF}?mode=0${back}`);
  logActivity(user.id, 'tailoring_mode', { profileId: saved.profileId, extras: { criterion, mode } });
  await rechooseForMember({ userId: user.id, email: user.email ?? null });
  revalidatePath(GOALS_EDITOR_HREF);
  revalidatePath('/today');
  redirect(`${GOALS_EDITOR_HREF}?mode=1${back}`);
}
