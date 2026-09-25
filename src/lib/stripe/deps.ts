import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getStripe } from './client';
import { savePaymentMethod } from './customer';
import { grantPlanCycle, grantTopup, grantUpgradeDifference } from './grants';
import { expirePlanGrants, grant } from '../credit/ledger';
import { cardNeedsUpdateEmail, paymentFailedEmail } from '../email/billing';
import { setSubscriptionCancelled, setSubscriptionStarted } from '../apis/monday';
import { getPlan } from '../credit/plans';
import { recordSubscriptionEvent } from '../billing/subscription-events';
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

/** The real dependencies for handleStripeEvent (the tests inject fakes). */
export function liveWebhookDeps(): WebhookDeps {
  const admin = createAdminClient();
  const stripe = getStripe();
  const one = async (q: PromiseLike<{ data: unknown }>): Promise<UserRow | null> => ((await q).data as UserRow | null) ?? null;
  return {
    findUserBySubscription: (id) => one(admin.from('profiles').select(SELECT).eq('stripe_subscription_id', id).maybeSingle()),
    findUserByCustomer: (id) => one(admin.from('profiles').select(SELECT).eq('stripe_customer_id', id).maybeSingle()),
    findUserByEmail: (email) => one(admin.from('profiles').select(SELECT).ilike('email', email).limit(1).maybeSingle()),
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
      // next credit repays it). Idempotent per (source, reason).
      await grant(userId, 'adjustment', -Math.abs(amountPence), { sourceRef: `${sourceRef}:${reason}`, description: reason === 'disputed' ? 'Top-up disputed — credit reversed' : 'Top-up refunded — credit reversed' });
    },
    onSubscriptionStarted: (email) => setSubscriptionStarted(email).catch(() => {}),
    onSubscriptionCancelled: (email) => setSubscriptionCancelled(email).catch(() => {}),
    paymentFailedEmail: async (email, planCode) => paymentFailedEmail(email, { planName: (await getPlan(planCode))?.name ?? null }),
    cardNeedsUpdateEmail: (email) => cardNeedsUpdateEmail(email),
    recordSubscriptionEvent: async (input) => {
      // The price is resolved HERE rather than in the handler, so the handler
      // stays pure and testable and only this file needs the plan table.
      const plan = input.planCode ? await getPlan(input.planCode) : null;
      return recordSubscriptionEvent(admin, {
        ...input,
        mrrPence: input.mrrPence ?? (plan ? monthlyPence({ pricePence: plan.pricePence, interval: plan.interval }) : null),
      });
    },
  };
}
