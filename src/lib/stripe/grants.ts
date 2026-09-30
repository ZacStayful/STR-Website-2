import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { expirePlanGrants, grant, getBalance } from '../credit/ledger';
import { getPlan, type BillingPlan } from '../credit/plans';
import { getBillingSettings } from '../credit/unit-costs';
import { planCreditFor } from '../credit/deal-pricing';
import { planRenewedEmail, topupReceiptEmail } from '../email/billing';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';

/**
 * Credit grants that follow Stripe money. Every grant is idempotent on its
 * source_ref, so a replayed webhook or a retried script can't double-credit.
 *
 * Plan credit per period (Batch 10): billing_settings.plan_credit_pence (£1
 * of credit for every £1 paid) for a period that starts on or after
 * new_pricing_from, the plan's old monthly_credit_pence for one that started
 * before. So a subscriber changes at their next renewal, never mid-period,
 * and an annual subscriber at their next ANNUAL renewal: its monthly slots
 * are judged by the start of the subscription year.
 */

/** A plan's monthly credit for a period starting at `periodStart`. */
async function planCredit(plan: BillingPlan, periodStart: Date): Promise<number> {
  const settings = await getBillingSettings();
  return planCreditFor(plan, periodStart, settings.dealPricing);
}

/** A new billing cycle: expire the old plan credit, grant the new. `periodStart` defaults to now (the renewal being paid). */
export async function grantPlanCycle(userId: string, planCode: string, sourceRef: string, periodEnd: Date | null, opts: { email?: string | null; notify?: boolean; periodStart?: Date } = {}): Promise<void> {
  const plan = await getPlan(planCode);
  if (!plan) {
    console.error(`[stripe] unknown plan ${planCode}; no credit granted for ${sourceRef}`);
    return;
  }
  const admin = createAdminClient();
  const { data: existing } = await admin.from('credit_grants').select('id').eq('source_ref', sourceRef).maybeSingle();
  if (existing) return; // replay
  const credit = await planCredit(plan, opts.periodStart ?? new Date());
  await expirePlanGrants(userId, 'renewal');
  await grant(userId, 'plan', credit, { expiresAt: periodEnd, sourceRef, description: `${plan.name} plan credit` });
  await admin.from('profiles').update({ plan_code: planCode, plan: 'pro', hit_zero_at: null }).eq('id', userId);
  if (opts.notify !== false && opts.email) {
    void planRenewedEmail(opts.email, { planName: plan.name, creditPence: credit, periodEnd: periodEnd?.toISOString() ?? null }).catch(() => {});
  }
  // Batch 20: Monday's row follows through the funnel queue (plan, credit, Total paid).
  await queueFunnelSync(userId, 'plan');
}

/**
 * A mid-cycle upgrade: tops this period's plan credit up to the new plan's.
 * The period is the one the current plan grant belongs to, so its credit
 * follows the same rule as the renewal that began it; what was already
 * granted this period (the old plan, earlier upgrades) comes off.
 */
export async function grantUpgradeDifference(userId: string, fromPlanCode: string | null, toPlanCode: string, sourceRef: string, periodEnd: Date | null): Promise<void> {
  const to = await getPlan(toPlanCode);
  if (!to) return;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: current } = await admin.from('credit_grants').select('amount_pence, created_at').eq('user_id', userId).eq('kind', 'plan').or(`expires_at.is.null,expires_at.gt.${nowIso}`).order('created_at', { ascending: true });
  const rows = (current ?? []) as { amount_pence: number | string; created_at: string }[];
  const granted = rows.reduce((sum, r) => sum + (Number(r.amount_pence) || 0), 0);
  // Nothing granted this period yet (should not happen): fall back to the old plan's credit, as before.
  const from = rows.length === 0 ? await getPlan(fromPlanCode) : null;
  const periodStart = rows.length > 0 ? new Date(rows[0].created_at) : new Date();
  const already = rows.length > 0 ? granted : (from ? await planCredit(from, periodStart) : 0);
  const diff = Math.max(0, (await planCredit(to, periodStart)) - already);
  await admin.from('profiles').update({ plan_code: toPlanCode, plan: 'pro' }).eq('id', userId);
  if (diff <= 0) return;
  await grant(userId, 'plan', diff, { expiresAt: periodEnd, sourceRef, description: `Upgrade to ${to.name}: extra plan credit` });
}

export async function grantTopup(userId: string, amountPence: number, sourceRef: string, opts: { email?: string | null } = {}): Promise<boolean> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from('credit_grants').select('id').eq('source_ref', sourceRef).maybeSingle();
  if (existing) return false;
  await grant(userId, 'topup', amountPence, { sourceRef, description: 'Top-up' });
  const now = new Date().toISOString();
  await admin.from('profiles').update({ last_topup_at: now, hit_zero_at: null }).eq('id', userId);
  // Team seats paused for want of credit come back now, not at the next
  // hourly sweep. Imported lazily: the seats module pulls in the debit path,
  // which leads back here through auto top-up.
  try {
    const { reinstateSeats } = await import('../team/seats');
    await reinstateSeats({ ownerId: userId });
  } catch (err) {
    console.error('[stripe] seat reinstatement after top-up failed:', (err as Error)?.message ?? err);
  }
  if (opts.email) {
    const bal = await getBalance(userId).catch(() => null);
    void topupReceiptEmail(opts.email, { amountPence, balancePence: bal?.totalPence ?? amountPence }).catch(() => {});
  }
  // Batch 20: Monday's row follows through the funnel queue (credit, top-ups, Total paid).
  await queueFunnelSync(userId, 'topup');
  return true;
}

/**
 * Annual plans are paid once but credit monthly: one grant per calendar
 * slot of the subscription year, each expiring at the next slot (or the
 * period end). Safe to call often; idempotent per slot.
 */
export async function ensureAnnualMonthlyGrant(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from('profiles').select('email, plan_code, stripe_subscription_id, current_period_end, stripe_subscription_status').eq('id', userId).maybeSingle();
  if (!data || data.plan_code !== 'pro_annual' || !data.stripe_subscription_id) return false;
  if (data.stripe_subscription_status && !['active', 'trialing', 'past_due'].includes(String(data.stripe_subscription_status))) return false;
  const end = data.current_period_end ? new Date(String(data.current_period_end)) : null;
  if (!end || end.getTime() <= Date.now()) return false;
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const now = new Date();
  // Slot index since the period start, by calendar month.
  const slot = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth()) - (now.getUTCDate() < start.getUTCDate() ? 1 : 0);
  if (slot < 0 || slot > 11) return false;
  const slotStart = new Date(start);
  slotStart.setUTCMonth(start.getUTCMonth() + slot);
  const slotEnd = new Date(start);
  slotEnd.setUTCMonth(start.getUTCMonth() + slot + 1);
  const expires = slotEnd.getTime() < end.getTime() ? slotEnd : end;
  const sourceRef = `annual:${data.stripe_subscription_id}:${slotStart.toISOString().slice(0, 7)}`;
  const { data: existing } = await admin.from('credit_grants').select('id').eq('source_ref', sourceRef).maybeSingle();
  if (existing) return false;
  // Judged by the start of the subscription YEAR: an annual plan changes to
  // the new credit at its next annual renewal, not at a monthly slot.
  await grantPlanCycle(userId, 'pro_annual', sourceRef, expires, { email: (data.email as string | null) ?? null, notify: slot > 0, periodStart: start });
  return true;
}
