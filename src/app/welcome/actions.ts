'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { geocodePostcode } from '@/lib/apis/geocode';
import { startAction } from '@/lib/credit/action';
import { runMetered } from '@/lib/credit/context';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { ensureWelcomeGrant } from '@/lib/credit/welcome';
import { isAdminEmail } from '@/lib/admin';
import { goalsFromWelcome, parseMarketGoals } from '@/lib/market/goals';
import { areaCodeFrom } from '@/lib/market/lead-goals';
import { parseWelcomeAnswers, WELCOME_FIELDS } from '@/lib/onboarding/answers';
import { dealsPathForGoals } from '@/lib/onboarding/deal-filters';
import { skipsFrom } from '@/lib/onboarding/status';
import { welcomeReturnPath } from '@/lib/auth/landing';

export type WelcomeState = { error: string | null };

function field(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === 'string' ? v : null;
}

/**
 * "Skip for now": count the skip (the screen stops after three), save
 * nothing else, and send the member on to where they were going.
 */
export async function skipWelcomeAction(formData: FormData): Promise<void> {
  const next = welcomeReturnPath(field(formData, WELCOME_FIELDS.next));
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase.from('profiles').select('onboarding_skips').eq('id', user.id).maybeSingle();
    const skips = skipsFrom((data as { onboarding_skips?: unknown } | null)?.onboarding_skips);
    const { error } = await supabase.from('profiles').update({ onboarding_skips: skips + 1 }).eq('id', user.id);
    if (error) console.error('[welcome] skip not recorded (schema behind?):', error.message);
  }
  redirect(next);
}

/**
 * The three answers become the member's goals (profiles.market_goals, the
 * same structure the Market Explorer edits) plus any chosen areas
 * (saved_areas, which the daily picks and weekly alerts already read).
 * Nothing else on the profile is touched: the notification switches belong
 * to the Account page. Ends on the deals that match.
 */
export async function completeWelcomeAction(_prev: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const parsed = parseWelcomeAnswers((k) => field(formData, k));
  if (!parsed.ok) return { error: parsed.error };
  const a = parsed.answers;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Please sign in again.' };

  // Goals saved meanwhile (the Explorer form in another tab) are the base;
  // otherwise a new member's defaults.
  const { data: row } = await supabase.from('profiles').select('market_goals').eq('id', user.id).maybeSingle();
  const existing = parseMarketGoals((row as { market_goals?: unknown } | null)?.market_goals);
  const goals = goalsFromWelcome({ kind: a.kind, budget: a.budget, maxRentPcm: a.maxRentPcm, postcode: a.postcode, maxDistanceMiles: a.maxDistanceMiles }, existing ?? undefined);

  const areas = new Set(a.areas);

  if (goals.home) {
    // Placed on the map the same way the Explorer's save does it — metered,
    // once — because the picks' distance rule needs coordinates. This may be
    // the member's very first request, so make sure the welcome credit exists.
    await ensureWelcomeGrant(user.id, user.email ?? null).catch((err) => console.warn('[welcome] welcome grant check failed:', (err as Error)?.message ?? err));
    let placed = false;
    try {
      const action = await startAction({ userId: user.id, admin: isAdminEmail(user.email), action: 'geocode' });
      try {
        const { lat, lng } = await runMetered(action.ctx, () => geocodePostcode(goals.home!.postcode));
        goals.home = { ...goals.home, lat, lng };
        placed = true;
      } finally {
        await action.finish().catch(() => {});
      }
    } catch (err) {
      const why = err instanceof InsufficientCreditError ? 'out of credit' : ((err as Error)?.message ?? String(err));
      console.warn(`[welcome] could not place ${goals.home.postcode}: ${why}`);
    }
    // Without coordinates the radius does nothing, so at least point the
    // picks and the deals grid at the postcode's own area.
    if (!placed) {
      const own = areaCodeFrom(goals.home.postcode);
      if (own) areas.add(own);
    }
  }

  const { error } = await supabase.from('profiles').update({ market_goals: goals, market_goals_updated_at: new Date().toISOString() }).eq('id', user.id);
  if (error) {
    console.error('[welcome] goals save failed:', error.message);
    return { error: 'Could not save your answers. Please try again.' };
  }

  if (areas.size > 0) {
    const rows = [...areas].map((postcode_area) => ({ user_id: user.id, postcode_area }));
    const { error: areaError } = await supabase.from('saved_areas').upsert(rows, { onConflict: 'user_id,postcode_area', ignoreDuplicates: true });
    if (areaError) console.error('[welcome] saved areas failed:', areaError.message);
  }

  revalidatePath('/markets');
  revalidatePath('/picks');
  redirect(dealsPathForGoals(goals, [...areas]));
}
