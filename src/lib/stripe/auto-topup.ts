import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '../supabase/admin';
import { getBalance } from '../credit/ledger';
import { getStripe, stripeConfigured } from './client';
import { grantTopup } from './grants';
import { cardNeedsUpdateEmail } from '../email/billing';
import { DEFAULT_TOPUP_THRESHOLD_PENCE } from '../credit/topup-floor';
import { recordActivity } from '../activity/log';
import { paymentFromIntent } from '../payments/rules';
import { recordPayment } from '../payments/server';
import { runAutoTopup, type AutoTopupDeps, type AutoTopupProfile } from './auto-topup-core';

/**
 * Opt-in auto top-up: the rule is in auto-topup-core.ts (tested); this is its
 * live wiring. Called from the meter after a debit (fire-and-forget).
 */
export function liveAutoTopupDeps(): AutoTopupDeps<Stripe.PaymentIntent> {
  return {
    configured: stripeConfigured,
    profile: async (userId) => {
      const { data: p } = await createAdminClient()
        .from('profiles')
        .select('email, stripe_customer_id, stripe_default_payment_method_id, auto_topup_amount_pence, auto_topup_threshold_pence, auto_topup_last_at')
        .eq('id', userId)
        .maybeSingle();
      return (p as AutoTopupProfile | null) ?? null;
    },
    spendableBasePence: async (userId) => (await getBalance(userId)).spendableBasePence,
    claim: async (userId, nowIso, cutoffIso) => {
      const { data: claimed } = await createAdminClient().from('profiles').update({ auto_topup_last_at: nowIso }).eq('id', userId).or(`auto_topup_last_at.is.null,auto_topup_last_at.lt.${cutoffIso}`).select('id');
      return Boolean(claimed && claimed.length > 0);
    },
    charge: (p) =>
      getStripe().paymentIntents.create(
        {
          amount: p.amountPence,
          currency: 'gbp',
          customer: p.customerId,
          payment_method: p.paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Stayful auto top-up £${(p.amountPence / 100).toFixed(2)}`,
          metadata: { user_id: p.userId, kind: 'topup', amount_pence: String(p.amountPence), auto: '1' },
        },
        { idempotencyKey: p.idempotencyKey },
      ),
    grantTopup: (userId, amountPence, sourceRef, opts) => grantTopup(userId, amountPence, sourceRef, opts),
    recordCharge: async (userId, pi, amountPence) => {
      // Batch 20: what was charged, for Total paid (the webhook writes the same row, once).
      await recordPayment(paymentFromIntent(pi, userId));
      await recordActivity(userId, 'auto_topup', { source: 'system', dedupeKey: `topup:pi:${pi.id}`, extras: { amount_pence: amountPence } });
    },
    switchOff: async (userId) => {
      await createAdminClient().from('profiles').update({ auto_topup_amount_pence: null }).eq('id', userId);
    },
    cardNeedsUpdate: (email) => cardNeedsUpdateEmail(email),
    now: () => new Date(),
    defaultThresholdPence: DEFAULT_TOPUP_THRESHOLD_PENCE,
  };
}

export function maybeAutoTopup(userId: string, deps: AutoTopupDeps<Stripe.PaymentIntent> = liveAutoTopupDeps()): Promise<'charged' | 'skipped' | 'failed'> {
  return runAutoTopup(userId, deps);
}
