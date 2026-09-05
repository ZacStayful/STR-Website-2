import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseMarketGoals, type MarketGoals } from '@/lib/market/goals';

export interface ExplorerUser {
  email: string | null;
  goals: MarketGoals | null;
  savedAreas: string[];
}

/**
 * The signed-in member's goal profile and watchlist (both optional). Takes
 * the user already resolved by getMarketAccess() so the request makes one
 * auth round-trip, not two.
 */
export async function loadExplorerUser(user: { id: string; email?: string | null } | null): Promise<ExplorerUser> {
  if (!user) return { email: null, goals: null, savedAreas: [] };
  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { data: saved }] = await Promise.all([
    supabase.from('profiles').select('market_goals').eq('id', user.id).single(),
    supabase.from('saved_areas').select('postcode_area').eq('user_id', user.id),
  ]);
  return {
    email: user.email ?? null,
    goals: parseMarketGoals(profile?.market_goals),
    savedAreas: (saved ?? []).map((s: { postcode_area: string }) => s.postcode_area.toUpperCase()),
  };
}
