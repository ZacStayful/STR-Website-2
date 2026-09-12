import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBalance, type Balance } from './ledger';
import { getBillingSettings } from './unit-costs';
import { getPlan } from './plans';
import { lowBalanceState, type BalanceState, type SpendRates } from './pricing';
import { isEnforcing } from './http';

/**
 * Everything the app chrome needs to know about a member's credit in one
 * object: buckets, the current cycle's allowance and how much of it is used
 * (drives the 80% banner), whether they are out, and top-up affordances.
 */
export interface CreditSummary {
  buckets: Balance['buckets'];
  totalPence: number;
  spendableBasePence: number;
  reservedBasePence: number;
  rates: SpendRates;
  cycle: { planCode: string | null; planName: string | null; allowancePence: number; usedPence: number; endsAt: string | null } | null;
  state: BalanceState;
  lowBalance: boolean;
  outOfCredit: boolean;
  enforcing: boolean;
  hasSavedCard: boolean;
  autoTopup: { amountPence: number | null; thresholdPence: number };
  topupPresetsPence: number[];
  welcomeWithheldReason: string | null;
}

export async function getCreditSummary(userId: string): Promise<CreditSummary> {
  const [balance, settings] = await Promise.all([getBalance(userId), getBillingSettings()]);
  interface BillingProfile {
    plan_code: string | null;
    current_period_end: string | null;
    stripe_default_payment_method_id: string | null;
    auto_topup_amount_pence: number | null;
    auto_topup_threshold_pence: number | null;
    welcome_withheld_reason: string | null;
  }
  let profile: BillingProfile | null = null;
  if (hasServiceRole()) {
    const { data } = await createAdminClient().from('profiles').select('plan_code, current_period_end, stripe_default_payment_method_id, auto_topup_amount_pence, auto_topup_threshold_pence, welcome_withheld_reason').eq('id', userId).maybeSingle();
    profile = (data as unknown as BillingProfile | null) ?? null;
  }
  const plan = await getPlan(profile?.plan_code);

  let cycle: CreditSummary['cycle'] = null;
  if (plan) {
    cycle = { planCode: plan.code, planName: plan.name, allowancePence: plan.monthlyCreditPence, usedPence: Math.max(0, plan.monthlyCreditPence - balance.buckets.planPence), endsAt: balance.planExpiresAt ?? profile?.current_period_end ?? null };
  } else {
    const welcome = settings.welcomeGrantPence;
    cycle = { planCode: null, planName: null, allowancePence: welcome, usedPence: Math.max(0, welcome - balance.buckets.welcomePence), endsAt: null };
  }

  const state = lowBalanceState({ cycleAllowancePence: cycle.allowancePence, cycleUsedPence: cycle.usedPence, spendableBasePence: balance.spendableBasePence, ratio: settings.lowBalanceRatio });
  return {
    buckets: balance.buckets,
    totalPence: balance.totalPence,
    spendableBasePence: balance.spendableBasePence,
    reservedBasePence: balance.reservedBasePence,
    rates: balance.rates,
    cycle,
    state,
    lowBalance: state === 'low',
    outOfCredit: state === 'out',
    enforcing: isEnforcing(),
    hasSavedCard: Boolean(profile?.stripe_default_payment_method_id),
    autoTopup: { amountPence: profile?.auto_topup_amount_pence ?? null, thresholdPence: profile?.auto_topup_threshold_pence ?? 500 },
    topupPresetsPence: settings.topupPresetsPence,
    welcomeWithheldReason: profile?.welcome_withheld_reason ?? null,
  };
}
