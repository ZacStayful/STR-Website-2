import { currentMember } from '@/lib/credit/auth';
import { getPlan } from '@/lib/credit/plans';
import { priceIdForPlan } from '@/lib/stripe/prices';
import { stripeConfigured, getStripe } from '@/lib/stripe/client';
import { ensureStripeCustomer, loadBillingProfile } from '@/lib/stripe/customer';
import { createCheckoutSession, returnUrl } from '@/lib/stripe/checkout';
import { safeInternalPath } from '@/lib/safe-path';

export const dynamic = 'force-dynamic';

/**
 * POST { planCode, returnTo? } → { url }. New subscribers go to Checkout;
 * members with a live subscription go to the billing portal to switch
 * plans (prorated by the portal configuration).
 */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet. Email hello@stayful.co.uk and we will set you up.' }, { status: 503 });

  let body: { planCode?: unknown; returnTo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const planCode = typeof body.planCode === 'string' ? body.planCode : '';
  const plan = await getPlan(planCode);
  const priceId = priceIdForPlan(planCode);
  if (!plan || !plan.active || !priceId) return Response.json({ error: 'That plan is not available.' }, { status: 400 });

  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });
  const back = safeInternalPath(typeof body.returnTo === 'string' ? body.returnTo : null, '/account/billing');

  try {
    const customer = await ensureStripeCustomer(profile, member.email);
    const stripe = getStripe();

    const live = profile.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(profile.stripe_subscription_status ?? '');
    if (live) {
      const portal = await stripe.billingPortal.sessions.create({
        customer,
        return_url: returnUrl('/account/billing'),
        ...(process.env.STRIPE_PORTAL_CONFIG_ID ? { configuration: process.env.STRIPE_PORTAL_CONFIG_ID } : {}),
        flow_data: {
          type: 'subscription_update_confirm',
          subscription_update_confirm: { subscription: profile.stripe_subscription_id!, items: [{ id: (await stripe.subscriptions.retrieve(profile.stripe_subscription_id!)).items.data[0].id, price: priceId, quantity: 1 }] },
          after_completion: { type: 'redirect', redirect: { return_url: returnUrl('/account/billing', { subscribed: '1' }) } },
        },
      });
      return Response.json({ url: portal.url, via: 'portal' });
    }

    const session = await createCheckoutSession({
      mode: 'subscription',
      customer,
      client_reference_id: member.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: member.id, plan_code: planCode } },
      allow_promotion_codes: true,
      success_url: returnUrl('/account/billing', { subscribed: '1', plan: planCode }),
      cancel_url: returnUrl(back.startsWith('/upgrade') ? back : '/upgrade', { redirect: back }),
      ...(process.env.STRIPE_TAX === 'true' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    });
    return Response.json({ url: session.url, via: 'checkout' });
  } catch (err) {
    console.error('[billing/subscribe] failed:', err);
    return Response.json({ error: "Couldn't start checkout. Please try again." }, { status: 502 });
  }
}
