import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { DEFAULT_TOPUP_THRESHOLD_PENCE } from './topup-floor';
import { getBalance, type Balance } from './ledger';
import { getBillingSettings } from './unit-costs';
import { getPlan } from './plans';
import { lowBalanceState, type BalanceState, type SpendRates } from './pricing';
import { isEnforcing } from './http';
import { accountStatus, type AccessProfile } from '../access';
import { isPackAccount } from '../lifecycle/settings';

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
  /** One day of daily deals in base pence (billing_settings.todays_5_daily_pence), for the Usage chip. */
  dailyDealsPence: number;
  /**
   * Batch 20: no live, trialling, past-due or paused plan (free, or lapsed):
   * low means £5 of credit or less (billing_settings.low_credit_pence), and
   * the choice offered is Starter or a £10 top-up.
   */
  noPlan: boolean;
}

/** Every welcome-kind grant this account has had, in pence. 0 when it cannot be read: the setting then stands. */
async function welcomeGrantedPence(userId: string): Promise<number> {
  if (!hasServiceRole()) return 0;
  const { data, error } = await createAdminClient().from('credit_grants').select('amount_pence').eq('user_id', userId).eq('kind', 'welcome');
  if (error) {
    console.warn('[credit] welcome grants read failed:', error.message);
    return 0;
  }
  return ((data ?? []) as { amount_pence: unknown }[]).reduce((n, r) => n + (Number(r.amount_pence) || 0), 0);
}

/**
 * Plan credit granted for the period the member is in: the renewal grant
 * plus any mid-cycle upgrade difference, i.e. every plan grant that has not
 * expired. 0 when it cannot be read or none is live.
 *
 * This, not `billing_plans.monthly_credit_pence`, is the allowance: plan
 * credit changes at each member's NEXT renewal, so while a change rolls out
 * the plan row says one thing and the member's current grant another.
 */
async function currentPlanGrantedPence(userId: string): Promise<number> {
  if (!hasServiceRole()) return 0;
  const { data, error } = await createAdminClient()
    .from('credit_grants')
    .select('amount_pence')
    .eq('user_id', userId)
    .eq('kind', 'plan')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) {
    console.warn('[credit] plan grants read failed:', error.message);
    return 0;
  }
  return ((data ?? []) as { amount_pence: unknown }[]).reduce((n, r) => n + (Number(r.amount_pence) || 0), 0);
}

export async function getCreditSummary(userId: string): Promise<CreditSummary> {
  // Annual subscribers are credited month by month; make sure this month's slot exists.
  try {
    const { ensureAnnualMonthlyGrant } = await import('../stripe/grants');
    await ensureAnnualMonthlyGrant(userId);
  } catch {
    /* never block the summary */
  }
  const [balance, settings] = await Promise.all([getBalance(userId), getBillingSettings()]);
  type BillingProfile = AccessProfile & {
    plan_code: string | null;
    current_period_end: string | null;
    stripe_default_payment_method_id: string | null;
    auto_topup_amount_pence: number | null;
    auto_topup_threshold_pence: number | null;
    welcome_withheld_reason: string | null;
    created_at: string | null;
  };
  let profile: BillingProfile | null = null;
  if (hasServiceRole()) {
    const { data } = await createAdminClient()
      .from('profiles')
      .select('plan_code, current_period_end, stripe_default_payment_method_id, auto_topup_amount_pence, auto_topup_threshold_pence, welcome_withheld_reason, created_at, plan, plan_source, reports_run, stripe_subscription_id, stripe_subscription_status, subscription_paused_from, subscription_paused_until, subscription_cancel_at')
      .eq('id', userId)
      .maybeSingle();
    profile = (data as unknown as BillingProfile | null) ?? null;
  }
  // Batch 20: with no plan (free or lapsed) the £5 rule decides "low".
  const status = profile ? accountStatus(profile) : null;
  const noPlan = status === 'free' || status === 'lapsed';
  const plan = await getPlan(profile?.plan_code);

  let cycle: CreditSummary['cycle'] = null;
  if (plan) {
    const granted = await currentPlanGrantedPence(userId);
    const allowance = granted > 0 ? granted : plan.monthlyCreditPence;
    cycle = { planCode: plan.code, planName: plan.name, allowancePence: allowance, usedPence: Math.max(0, allowance - balance.buckets.planPence), endsAt: balance.planExpiresAt ?? profile?.current_period_end ?? null };
  } else {
    // Welcome credit is the welcome grant plus any first-week checklist
    // rewards (src/lib/today/checklist.ts), which are welcome-kind so they
    // spend at face value. Measured against what was actually granted, so the
    // rewards cannot make "used" read low; never below the setting, so an
    // account whose welcome was withheld reads exactly as it always has.
    // Batch 20: an account from the starter pack's cutover never had the welcome
    // credit, so it is measured only against what it was given (the pack's bonus).
    const floor = isPackAccount(profile?.created_at ?? null, settings.lifecycle) ? 0 : settings.welcomeGrantPence;
    const welcome = Math.max(floor, await welcomeGrantedPence(userId));
    cycle = welcome > 0 ? { planCode: null, planName: null, allowancePence: welcome, usedPence: Math.max(0, welcome - balance.buckets.welcomePence), endsAt: null } : null;
  }

  const state = lowBalanceState({
    cycleAllowancePence: cycle?.allowancePence ?? 0,
    cycleUsedPence: cycle?.usedPence ?? 0,
    spendableBasePence: balance.spendableBasePence,
    ratio: settings.lowBalanceRatio,
    balancePence: balance.totalPence,
    lowCreditPence: noPlan ? settings.lifecycle.lowCreditPence : null,
  });
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
    autoTopup: { amountPence: profile?.auto_topup_amount_pence ?? null, thresholdPence: profile?.auto_topup_threshold_pence ?? DEFAULT_TOPUP_THRESHOLD_PENCE },
    topupPresetsPence: settings.topupPresetsPence,
    welcomeWithheldReason: profile?.welcome_withheld_reason ?? null,
    dailyDealsPence: settings.dealPricing.todays5DailyPence,
    noPlan,
  };
}
