import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { perksFor, type PlanPerks } from './perks';

/** A subscription tier as shown on /upgrade and used by Stripe checkout. */
export interface BillingPlan {
  code: string;
  name: string;
  pricePence: number;
  interval: 'month' | 'year';
  monthlyCreditPence: number;
  perks: PlanPerks;
  sort: number;
  active: boolean;
}

export const FALLBACK_PLANS: BillingPlan[] = [
  { code: 'starter', name: 'Starter', pricePence: 1900, interval: 'month', monthlyCreditPence: 1900, perks: perksFor('starter'), sort: 1, active: true },
  { code: 'pro', name: 'Pro', pricePence: 3999, interval: 'month', monthlyCreditPence: 5000, perks: perksFor('pro'), sort: 2, active: true },
  { code: 'scale', name: 'Scale', pricePence: 9900, interval: 'month', monthlyCreditPence: 14000, perks: perksFor('scale'), sort: 3, active: true },
  { code: 'pro_annual', name: 'Pro (annual)', pricePence: 36000, interval: 'year', monthlyCreditPence: 5000, perks: perksFor('pro_annual'), sort: 4, active: true },
];

let cache: { at: number; plans: BillingPlan[] } | null = null;

export async function getPlans(): Promise<BillingPlan[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.plans;
  if (!hasServiceRole()) return FALLBACK_PLANS;
  try {
    const { data, error } = await createAdminClient().from('billing_plans').select('code, name, price_pence, interval, monthly_credit_pence, perks, sort, active').order('sort');
    if (error) throw new Error(error.message);
    const plans = (data ?? []).map((r) => ({
      code: String(r.code),
      name: String(r.name),
      pricePence: Number(r.price_pence) || 0,
      interval: (r.interval === 'year' ? 'year' : 'month') as 'month' | 'year',
      monthlyCreditPence: Number(r.monthly_credit_pence) || 0,
      perks: perksFor(String(r.code), (r.perks ?? null) as Partial<PlanPerks> | null),
      sort: Number(r.sort) || 0,
      active: r.active !== false,
    }));
    if (plans.length === 0) return FALLBACK_PLANS;
    cache = { at: Date.now(), plans };
    return plans;
  } catch (err) {
    console.error('[credit] billing_plans read failed, using fallback:', err);
    return FALLBACK_PLANS;
  }
}

export async function getPlan(code: string | null | undefined): Promise<BillingPlan | null> {
  if (!code) return null;
  return (await getPlans()).find((p) => p.code === code) ?? null;
}
