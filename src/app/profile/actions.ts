'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseMarketGoals, MIN_MONTHS_RANGE, MIN_WEEKS_RANGE, type Priority } from '@/lib/market/goals';
import { profileSummaryFor } from '@/lib/profile/server';
import { logActivity } from '@/lib/activity/log';
import { GOALS_EDITOR_HREF } from '@/lib/nav';

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
  void MIN_MONTHS_RANGE;
  void MIN_WEEKS_RANGE;

  const { error } = await supabase.from('profiles').update({ market_goals: next, market_goals_updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) {
    console.error('[profile] advanced save failed:', error.message);
    redirect(`${GOALS_EDITOR_HREF}?saved=0`);
  }
  logActivity(user.id, 'profile_edited', { extras: { question: 'advanced', section: 'advanced' } });
  revalidatePath(GOALS_EDITOR_HREF);
  revalidatePath('/markets');
  redirect(`${GOALS_EDITOR_HREF}?saved=1#advanced`);
}
