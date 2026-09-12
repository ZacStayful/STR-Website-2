import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { expirePlanGrants, grant, getBalance } from '../credit/ledger';
import { getPlan } from '../credit/plans';
import { planRenewedEmail, topupReceiptEmail } from '../email/billing';
import { setBillingState } from '../apis/monday';

/**
 * Credit grants that follow Stripe money. Every grant is idempotent on its
 * source_ref, so a replayed webhook or a retried script can't double-credit.
 */

/** A new billing cycle: expire the old plan credit, grant the new. */
export async function grantPlanCycle(userId: string, planCode: string, sourceRef: string, periodEnd: Date | null, opts: { email?: string | null; notify?: boolean } = {}): Promise<void> {
  const plan = await getPlan(planCode);
  if (!plan) {
    console.error(`[stripe] unknown plan ${planCode}; no credit granted for ${sourceRef}`);
    return;
  }
  const admin = createAdminClient();
  const { data: existing } = await admin.from('credit_grants').select('id').eq('source_ref', sourceRef).maybeSingle();
  if (existing) return; // replay
  await expirePlanGrants(userId, 'renewal');
  await grant(userId, 'plan', plan.monthlyCreditPence, { expiresAt: periodEnd, sourceRef, description: `${plan.name} plan credit` });
  await admin.from('profiles').update({ plan_code: planCode, plan: 'pro' }).eq('id', userId);
  if (opts.notify !== false && opts.email) {
    void planRenewedEmail(opts.email, { planName: plan.name, creditPence: plan.monthlyCreditPence, periodEnd: periodEnd?.toISOString() ?? null }).catch(() => {});
    void syncMonday(userId, opts.email).catch(() => {});
  }
}

/** A mid-cycle upgrade: credit the difference between the two plans' monthly credit. */
export async function grantUpgradeDifference(userId: string, fromPlanCode: string | null, toPlanCode: string, sourceRef: string, periodEnd: Date | null): Promise<void> {
  const [from, to] = await Promise.all([getPlan(fromPlanCode), getPlan(toPlanCode)]);
  if (!to) return;
  const diff = Math.max(0, to.monthlyCreditPence - (from?.monthlyCreditPence ?? 0));
  await createAdminClient().from('profiles').update({ plan_code: toPlanCode, plan: 'pro' }).eq('id', userId);
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
  if (opts.email) {
    const bal = await getBalance(userId).catch(() => null);
    void topupReceiptEmail(opts.email, { amountPence, balancePence: bal?.totalPence ?? amountPence }).catch(() => {});
    void syncMonday(userId, opts.email, { lastTopupAt: now, status: 'Topped up' }).catch(() => {});
  }
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
  await grantPlanCycle(userId, 'pro_annual', sourceRef, expires, { email: (data.email as string | null) ?? null, notify: slot > 0 });
  return true;
}

export async function syncMonday(userId: string, email: string, extra: { lastTopupAt?: string | null; status?: string; hitZeroAt?: string | null } = {}): Promise<void> {
  const admin = createAdminClient();
  const [{ data }, bal] = await Promise.all([admin.from('profiles').select('plan_code').eq('id', userId).maybeSingle(), getBalance(userId).catch(() => null)]);
  await setBillingState(email, { planCode: (data?.plan_code as string | null) ?? null, balancePence: bal?.totalPence, ...extra });
}
