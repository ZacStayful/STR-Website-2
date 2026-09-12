import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '../supabase/admin';
import { getStripe } from './client';

export interface BillingProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  plan_code: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  stripe_default_payment_method_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  auto_topup_amount_pence: number | null;
  auto_topup_threshold_pence: number | null;
  last_topup_at: string | null;
  terms_accepted_at: string | null;
}

export async function loadBillingProfile(userId: string): Promise<BillingProfileRow | null> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('id, email, full_name, plan_code, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, stripe_default_payment_method_id, current_period_end, cancel_at_period_end, auto_topup_amount_pence, auto_topup_threshold_pence, last_topup_at, terms_accepted_at')
    .eq('id', userId)
    .maybeSingle();
  return (data as unknown as BillingProfileRow | null) ?? null;
}

/** Reuses the profile's Stripe customer or creates one tagged with the user id. */
export async function ensureStripeCustomer(profile: BillingProfileRow, email: string | null): Promise<string> {
  const stripe = getStripe();
  if (profile.stripe_customer_id) {
    try {
      const c = await stripe.customers.retrieve(profile.stripe_customer_id);
      if (!('deleted' in c && c.deleted)) return profile.stripe_customer_id;
    } catch {
      /* fall through and create */
    }
  }
  const customer = await stripe.customers.create({
    email: email ?? profile.email ?? undefined,
    name: profile.full_name ?? undefined,
    metadata: { user_id: profile.id },
  });
  await createAdminClient().from('profiles').update({ stripe_customer_id: customer.id }).eq('id', profile.id);
  return customer.id;
}

/** Saves a payment method as the member's one-click card (profile + Stripe default). */
export async function savePaymentMethod(userId: string, customerId: string | null, paymentMethodId: string): Promise<void> {
  await createAdminClient().from('profiles').update({ stripe_default_payment_method_id: paymentMethodId }).eq('id', userId);
  if (customerId) {
    try {
      await getStripe().customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
    } catch (err) {
      console.warn('[stripe] could not set default payment method on customer:', (err as Error).message);
    }
  }
}

export async function cardSummary(paymentMethodId: string | null): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null> {
  if (!paymentMethodId) return null;
  try {
    const pm: Stripe.PaymentMethod = await getStripe().paymentMethods.retrieve(paymentMethodId);
    if (!pm.card) return null;
    return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  } catch {
    return null;
  }
}
