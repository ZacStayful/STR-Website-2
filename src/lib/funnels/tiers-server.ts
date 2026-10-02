import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { DEFAULT_FUNNEL_TIER_SETTINGS, parseTierSettings, pricingFor, ukMonthKey, type FunnelTierSettings } from './tiers';

/**
 * Batch 22f: the tier settings, an owner's pricing ('tiers' or 'legacy') and
 * their month so far. Reads only; the charge itself is funnel_lead_charge
 * (src/lib/funnels/charge-server.ts).
 */

const CACHE_MS = 60_000;
let cache: { at: number; settings: FunnelTierSettings } | null = null;

export async function getFunnelTierSettings(): Promise<FunnelTierSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.settings;
  if (!hasServiceRole()) return DEFAULT_FUNNEL_TIER_SETTINGS;
  try {
    const { data, error } = await createAdminClient()
      .from('billing_settings')
      .select('key, value')
      .in('key', ['funnel_tiers', 'funnel_enhanced_extra_pence', 'funnel_tiers_from', 'funnel_notice_days']);
    if (error) throw new Error(error.message);
    const kv = new Map<string, unknown>((data ?? []).map((r) => [String(r.key), r.value]));
    const settings = parseTierSettings((k) => kv.get(k));
    cache = { at: Date.now(), settings };
    return settings;
  } catch (err) {
    console.error('[funnel-tiers] settings read failed, using defaults:', err);
    return DEFAULT_FUNNEL_TIER_SETTINGS;
  }
}

export function invalidateFunnelTierCache(): void {
  cache = null;
}

export interface OwnerPricing {
  mode: 'tiers' | 'legacy';
  /** Leads charged so far this UK month (tiers only; 0 for legacy). */
  monthCount: number;
  noticeSentAt: Date | null;
  firstFunnelAt: Date | null;
}

/**
 * Which pricing an owner's funnel leads are on right now, and how many they
 * have had this month. Read failures fall to 'legacy': the price the owner
 * already had, never a new one by accident.
 */
export async function ownerPricing(ownerId: string, settings?: FunnelTierSettings, now: Date = new Date()): Promise<OwnerPricing> {
  const s = settings ?? (await getFunnelTierSettings());
  if (!hasServiceRole()) return { mode: 'legacy', monthCount: 0, noticeSentAt: null, firstFunnelAt: null };
  try {
    const admin = createAdminClient();
    const [first, profile, month] = await Promise.all([
      admin.from('funnels').select('created_at').eq('user_id', ownerId).order('created_at', { ascending: true }).limit(1),
      admin.from('profiles').select('funnel_price_notice_sent_at').eq('id', ownerId).maybeSingle(),
      admin.from('funnel_lead_months').select('leads').eq('owner_id', ownerId).eq('month', ukMonthKey(now)).maybeSingle(),
    ]);
    if (first.error) throw new Error(first.error.message);
    if (profile.error) throw new Error(profile.error.message);
    const firstAt = first.data?.[0]?.created_at ? new Date(String(first.data[0].created_at)) : null;
    const sentRaw = (profile.data as { funnel_price_notice_sent_at?: string | null } | null)?.funnel_price_notice_sent_at;
    const noticeSentAt = sentRaw ? new Date(sentRaw) : null;
    const mode = pricingFor({ firstFunnelAt: firstAt, noticeSentAt, now }, s);
    return { mode, monthCount: month.error ? 0 : Number(month.data?.leads ?? 0) || 0, noticeSentAt, firstFunnelAt: firstAt };
  } catch (err) {
    console.error('[funnel-tiers] owner pricing read failed, keeping legacy:', err);
    return { mode: 'legacy', monthCount: 0, noticeSentAt: null, firstFunnelAt: null };
  }
}
