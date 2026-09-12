import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getStripe } from './client';
import { savePaymentMethod } from './customer';
import { grantPlanCycle, grantTopup, grantUpgradeDifference } from './grants';
import { expirePlanGrants, grant } from '../credit/ledger';
import { cardNeedsUpdateEmail, paymentFailedEmail } from '../email/billing';
import { setSubscriptionCancelled, setSubscriptionStarted } from '../apis/monday';
import { getPlan } from '../credit/plans';
import type { WebhookDeps } from './webhook';

type UserRow = { id: string; email: string | null; plan_code: string | null };

const SELECT = 'id, email, plan_code';

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
  };
}
