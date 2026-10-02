import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { emailKey } from '../supabase/email-key';
import { getStripe } from './client';
import { savePaymentMethod } from './customer';
import { grantPlanCycle, grantTopup, grantUpgradeDifference } from './grants';
import { expirePlanGrants, grant } from '../credit/ledger';
import { cardNeedsUpdateEmail, paymentFailedEmail } from '../email/billing';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { getPlan } from '../credit/plans';
import { recordSubscriptionEvent } from '../billing/subscription-events';
import { recordActivity } from '../activity/log';
import { recordConversion } from '../meta/conversions';
import { recordPayment, recordRefund } from '../payments/server';
import { clawbackStarterPack, grantStarterPack, settleStarterPack } from '../starter-pack/grant-server';
import { monthlyPence } from '../billing/churn';
import type { WebhookDeps } from './webhook';

type UserRow = {
  id: string;
  email: string | null;
  plan_code: string | null;
  plan_source: string | null;
  cancel_reason: string | null;
  cancel_reason_comment: string | null;
  subscription_cancel_at: string | null;
  subscription_paused_until: string | null;
  stripe_subscription_status: string | null;
};

// The last five are what the churn log needs and the profile write alone did
// not: the reason captured when the cancellation was SCHEDULED (read on the way
// out, while it is still on the row), and the previous state, so a genuinely
// new pause or cancellation can be told from Stripe re-sending the same object.
const SELECT =
  'id, email, plan_code, plan_source, cancel_reason, cancel_reason_comment, subscription_cancel_at, subscription_paused_until, stripe_subscription_status';

/** The pence already taken back under `base` and `base:<n>`: the negative adjustments a refund or dispute wrote. */
async function takenUnder(userId: string, base: string): Promise<number> {
  const admin = createAdminClient();
  const [exact, later] = await Promise.all([
    admin.from('credit_grants').select('amount_pence').eq('user_id', userId).eq('kind', 'adjustment').eq('source_ref', base),
    admin.from('credit_grants').select('amount_pence').eq('user_id', userId).eq('kind', 'adjustment').like('source_ref', `${base}:%`),
  ]);
  if (exact.error) throw new Error(exact.error.message);
  if (later.error) throw new Error(later.error.message);
  return [...(exact.data ?? []), ...(later.data ?? [])].reduce((sum, r) => sum + Math.max(0, -(Number((r as { amount_pence: unknown }).amount_pence) || 0)), 0);
}

/** The real dependencies for handleStripeEvent (the tests inject fakes). */
export function liveWebhookDeps(): WebhookDeps {
  const admin = createAdminClient();
  const stripe = getStripe();
  // Batch 21 (B3): a failed read throws, so the route answers 500 and Stripe
  // sends the event again. Reading `.data` alone turned a transient Supabase
  // error into "no user", which marked the event processed for ever: the
  // member was charged and never credited.
  const one = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<UserRow | null> => {
    const { data, error } = await q;
    if (error) throw new Error(`profile lookup failed: ${error.message}`);
    return (data as UserRow | null) ?? null;
  };
  // Batch 21 (B39): an email that matches more than one profile matches none.
  const byEmail = async (email: string): Promise<UserRow | null> => {
    const { data, error } = await admin.from('profiles').select(SELECT).eq('email', emailKey(email)).limit(2);
    if (error) throw new Error(`profile lookup failed: ${error.message}`);
    const rows = (data ?? []) as UserRow[];
    if (rows.length > 1) console.error(`[stripe/webhook] ${rows.length} profiles share an email; not matching the payment by email`);
    return rows.length === 1 ? rows[0] : null;
  };
  return {
    findUserBySubscription: (id) => one(admin.from('profiles').select(SELECT).eq('stripe_subscription_id', id).maybeSingle()),
    findUserByCustomer: (id) => one(admin.from('profiles').select(SELECT).eq('stripe_customer_id', id).maybeSingle()),
    findUserByEmail: byEmail,
    findUserById: (id) => one(admin.from('profiles').select(SELECT).eq('id', id).maybeSingle()),
    updateProfile: async (userId, patch) => {
      const { error } = await admin.from('profiles').update(patch).eq('id', userId);
      if (error) throw new Error(error.message);
    },
    grantPlanCycle: (userId, planCode, sourceRef, periodEnd, email) => grantPlanCycle(userId, planCode, sourceRef, periodEnd, { email }),
    grantUpgradeDifference,
    grantTopup: (userId, amountPence, sourceRef, email) => grantTopup(userId, amountPence, sourceRef, { email }),
    expirePlanGrants,
    savePaymentMethod,
    retrievePaymentIntent: async (id) => {
      try {
        return await stripe.paymentIntents.retrieve(id);
      } catch {
        return null;
      }
    },
    retrievePaymentIntentStrict: async (id) => {
      try {
        return await stripe.paymentIntents.retrieve(id);
      } catch (err) {
        if ((err as { code?: string }).code === 'resource_missing') return null;
        throw err;
      }
    },
    retrieveSubscription: async (id) => {
      try {
        return await stripe.subscriptions.retrieve(id);
      } catch {
        return null;
      }
    },
    listSubscriptions: async (customerId) => {
      try {
        return (await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })).data;
      } catch (err) {
        console.error('[stripe/webhook] could not list subscriptions', customerId, err);
        return [];
      }
    },
    refundTopup: async (userId, sourceRef, amountPence, reason) => {
      // Claw back what was refunded / disputed as a negative adjustment (the
      // member may have spent some of it; the ledger goes negative until the
      // next credit repays it). A dispute is one amount, once per source. A
      // refund is cumulative (Batch 21, B36): `amountPence` is the charge's
      // total refunded so far, and only the part not yet taken back is taken,
      // under `<source>:refunded` the first time and `<source>:refunded:<total>`
      // for a later partial refund, as the starter pack does.
      const base = `${sourceRef}:${reason}`;
      const target = Math.abs(amountPence);
      if (reason !== 'refunded') {
        await grant(userId, 'adjustment', -target, { sourceRef: base, description: 'Top-up disputed — credit reversed' });
        return;
      }
      const taken = await takenUnder(userId, base);
      const diff = Math.round(target - taken);
      if (diff <= 0) return;
      await grant(userId, 'adjustment', -diff, { sourceRef: taken > 0 ? `${base}:${Math.round(target)}` : base, description: 'Top-up refunded — credit reversed' });
    },
    // Batch 21 (B17): a dispute closed in the member's favour gives back what was taken under `pi:<id>:disputed` (a top-up's one adjustment, or a pack's cumulative clawback).
    restoreDisputedCredit: async (userId, paymentIntentId) => {
      const taken = await takenUnder(userId, `pi:${paymentIntentId}:disputed`);
      if (taken <= 0) return 0;
      await grant(userId, 'adjustment', taken, { sourceRef: `pi:${paymentIntentId}:dispute_won`, description: 'Dispute closed in your favour — credit restored' });
      return taken;
    },
    // Batch 20: Monday's row (plan, group, First payment, Cancel date) follows through the funnel queue.
    onSubscriptionStarted: async (email) => queueFunnelSync((await byEmail(email))?.id, 'plan'),
    onSubscriptionCancelled: async (email) => queueFunnelSync((await byEmail(email))?.id, 'plan'),
    paymentFailedEmail: async (email, planCode) => paymentFailedEmail(email, { planName: (await getPlan(planCode))?.name ?? null }),
    cardNeedsUpdateEmail: (email) => cardNeedsUpdateEmail(email),
    logActivity: (a) => recordActivity(a.userId, a.kind, { dedupeKey: a.dedupeKey, source: a.source, extras: a.extras }),
    // Batch 23: the auto top-up link's checkout switches auto top-up on, only if it is still off.
    enableAutoTopup: async (userId, amountPence, thresholdPence) => {
      const { data, error } = await createAdminClient().from('profiles').update({ auto_topup_amount_pence: amountPence, auto_topup_threshold_pence: thresholdPence }).eq('id', userId).is('auto_topup_amount_pence', null).select('id');
      if (error) {
        console.error('[stripe/webhook] auto top-up switch-on failed:', error.message);
        return false;
      }
      return (data ?? []).length === 1;
    },
    // Batch 19: awaited, as the webhook has no browser and must not return before it is recorded.
    recordConversion: (c) => recordConversion(c),
    // Batch 20: the rows behind "Total paid" (src/lib/payments).
    recordPayment: (payment) => recordPayment(payment),
    recordRefund: (refund) => recordRefund(refund),
    invoicePaymentIntent: async (invoiceId) => {
      const list = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 5 });
      for (const p of list.data) {
        const pi = p.payment?.payment_intent;
        if (pi) return typeof pi === 'string' ? pi : pi.id;
      }
      return null;
    },
    // Batch 20: the £10 starter pack (src/lib/starter-pack/grant-server.ts).
    settleStarterPack: (paymentIntentId) => settleStarterPack(paymentIntentId),
    grantStarterPack: (input) => grantStarterPack(input),
    clawbackStarterPack: (input) => clawbackStarterPack(input),
    recordSubscriptionEvent: async (input) => {
      // The price is resolved HERE rather than in the handler, so the handler
      // stays pure and testable and only this file needs the plan table.
      const plan = input.planCode ? await getPlan(input.planCode) : null;
      // Batch 20: every plan change (started, paused, cancellation booked, ended, past due...) moves the Monday row.
      await queueFunnelSync(input.userId, input.kind === 'past_due' ? 'payment_failed' : 'plan');
      return recordSubscriptionEvent(admin, {
        ...input,
        mrrPence: input.mrrPence ?? (plan ? monthlyPence({ pricePence: plan.pricePence, interval: plan.interval }) : null),
      });
    },
  };
}
