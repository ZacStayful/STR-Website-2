import 'server-only';

import { cache } from 'react';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { payerFor } from '../team';
import { hasEverPaid, PAID_TIER_COLUMNS } from '../access';
import { getBillingSettings } from '../credit/unit-costs';
import { dealVisibility, type DealTier, type DealVisibility } from './visibility';

/**
 * Which tier a signed-in person is in for the deals marketplace. A team
 * member takes the owner's tier, because the owner's account is the one that
 * paid. Cached per request: the grid, the map counts and the deal page all
 * ask. On a read failure the answer is 'free' — the delayed set — because
 * showing a deal early is the mistake this module exists to prevent.
 */
export const dealTierFor = cache(async (userId: string | null, adminUser: boolean): Promise<DealTier> => {
  if (adminUser) return 'paid';
  if (!userId || !hasServiceRole()) return 'free';
  const payer = await payerFor(userId);
  const { data, error } = await createAdminClient().from('profiles').select(PAID_TIER_COLUMNS).eq('id', payer.payerId).maybeSingle();
  if (error) {
    console.error('[marketplace] tier read failed:', error.message);
    return 'free';
  }
  return hasEverPaid(data) ? 'paid' : 'free';
});

/** The visibility a signed-in person's reads should apply. */
export async function dealVisibilityFor(userId: string | null, adminUser: boolean, now: Date = new Date()): Promise<DealVisibility> {
  const [tier, settings] = await Promise.all([dealTierFor(userId, adminUser), getBillingSettings()]);
  const v = dealVisibility(tier, now, settings.freeDealDelayHours);
  // Batch 22: a free member sees the deals their own search first found at once. Set here and only here.
  if (v.cutoffIso && userId) {
    const own = await ownFindsFor(userId);
    if (own.length > 0) return { ...v, ownFinds: own };
  }
  return v;
}

/** Deals this member's own search first inserted (member_search_finds; one finder per deal), newest 100, per request. */
const ownFindsFor = cache(async (userId: string): Promise<string[]> => {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient().from('member_search_finds').select('deal_id').eq('user_id', userId).order('found_at', { ascending: false }).limit(100);
  if (error) return [];
  return ((data ?? []) as { deal_id: string }[]).map((r) => r.deal_id);
});

/** What a signed-out visitor sees: the delayed set, never more than a free member. */
export async function publicDealVisibility(now: Date = new Date()): Promise<DealVisibility> {
  const settings = await getBillingSettings();
  return dealVisibility('free', now, settings.freeDealDelayHours);
}
