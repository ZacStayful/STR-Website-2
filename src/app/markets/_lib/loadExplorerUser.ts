import 'server-only';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseMarketGoals, type MarketGoals } from '@/lib/market/goals';
import { toCheckedListingRow, type CheckedListingRow } from '@/lib/listing/pipeline';

export interface ExplorerUser {
  email: string | null;
  goals: MarketGoals | null;
  savedAreas: string[];
  alertWeekly: boolean;
  /** The member's checked listings (deal pipeline), newest first. */
  listings: CheckedListingRow[];
}

/**
 * The signed-in member's goal profile and watchlist (both optional). Takes
 * the user already resolved by getMarketAccess() so the request makes one
 * auth round-trip, not two.
 */
export async function loadExplorerUser(user: { id: string; email?: string | null } | null): Promise<ExplorerUser> {
  if (!user) return { email: null, goals: null, savedAreas: [], alertWeekly: true, listings: [] };
  const supabase = await createSupabaseServerClient();
  const [profileRes, { data: saved }, listingsRes] = await Promise.all([
    supabase.from('profiles').select('market_goals, alert_weekly').eq('id', user.id).single(),
    supabase.from('saved_areas').select('postcode_area').eq('user_id', user.id),
    supabase
      .from('checked_listings')
      .select('id, canonical_url, source, kind, postcode, postcode_area, lat, lng, snapshot, quick_estimate, deal, status, notes, share_token, analysed_report_id, listing_status, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(200),
  ]);
  if (listingsRes.error) console.warn('[markets] checked_listings select failed (schema behind?):', listingsRes.error.message);
  const listings = ((listingsRes.data ?? []) as Record<string, unknown>[]).map(toCheckedListingRow).filter((r): r is CheckedListingRow => r !== null);
  // Tolerate a database that hasn't had the Phase 3 column added yet: fall
  // back to the goals-only select rather than silently losing the goals.
  let profile = profileRes.data as { market_goals: unknown; alert_weekly?: boolean } | null;
  if (profileRes.error) {
    console.warn('[markets] profile select failed (schema behind?):', profileRes.error.message);
    const fallback = await supabase.from('profiles').select('market_goals').eq('id', user.id).single();
    profile = fallback.data ?? null;
  }
  return {
    email: user.email ?? null,
    goals: parseMarketGoals(profile?.market_goals),
    savedAreas: (saved ?? []).map((s: { postcode_area: string }) => s.postcode_area.toUpperCase()),
    alertWeekly: profile?.alert_weekly !== false,
    listings,
  };
}
