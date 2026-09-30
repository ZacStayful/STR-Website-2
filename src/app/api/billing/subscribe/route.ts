import { currentMember } from '@/lib/credit/auth';
import { getPlan } from '@/lib/credit/plans';
import { priceIdForPlan } from '@/lib/stripe/prices';
import { stripeConfigured, getStripe } from '@/lib/stripe/client';
import { ensureStripeCustomer, loadBillingProfile } from '@/lib/stripe/customer';
import { createCheckoutSession, returnUrl } from '@/lib/stripe/checkout';
import { safeInternalPath } from '@/lib/safe-path';
import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity/log';
import { todayKey } from '@/lib/today/day';

export const dynamic = 'force-dynamic';

/**
 * POST { planCode, returnTo? } → { url }. New subscribers go to Checkout;
 * members with a live subscription go to the billing portal to switch
 * plans (prorated by the portal configuration).
 *
 * Batch 20, Part B: { savedCard: true, termsAccepted: true, nonce } from our
 * own confirm screen (the low-credit decision) starts the plan on the saved
 * card → { ok }: the first invoice is paid off-session or nothing is created
 * (error_if_incomplete), and anything Stripe cannot do that way (3-D Secure,
 * a missing tax address) falls back to Checkout. The webhook records the plan
 * and grants its credit, as it does for Checkout. `via: 'low_credit'` records
 * the choice (weekly active).
 */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  // The team's owner pays and buys; a member cannot spend on their card.
  if (member.teamMember) return Response.json({ error: 'Billing is managed by your team’s account owner.' }, { status: 403 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet. Email hello@stayful.co.uk and we will set you up.' }, { status: 503 });

  let body: { planCode?: unknown; returnTo?: unknown; savedCard?: unknown; termsAccepted?: unknown; nonce?: unknown; via?: unknown };
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
  if (body.via === 'low_credit') logActivity(member.id, 'low_credit_starter', { dedupeKey: `low_credit_starter:${todayKey(new Date())}`, extras: { plan: planCode } });
  const nonce = typeof body.nonce === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.nonce) ? body.nonce : crypto.randomUUID();

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

    // Batch 20: on the saved card, from our own confirm screen (which showed the price, the renewal and the terms).
    if (body.savedCard === true && body.termsAccepted === true && profile.stripe_default_payment_method_id) {
      try {
        // Stripe is asked, not just the profile (the webhook may not have written a plan started seconds ago).
        const existing = await stripe.subscriptions.list({ customer, limit: 10 });
        if (existing.data.some((x) => ['active', 'trialing', 'past_due', 'incomplete'].includes(x.status))) {
          return Response.json({ error: 'You already have a plan. Manage it from Billing.' }, { status: 409 });
        }
        const sub = await stripe.subscriptions.create(
          {
            customer,
            items: [{ price: priceId, quantity: 1 }],
            default_payment_method: profile.stripe_default_payment_method_id,
            payment_behavior: 'error_if_incomplete',
            off_session: true,
            metadata: { user_id: member.id, plan_code: planCode },
            ...(process.env.STRIPE_TAX === 'true' ? { automatic_tax: { enabled: true } } : {}),
          },
          { idempotencyKey: `subscribe:${member.id}:${planCode}:${nonce}` },
        );
        if (sub.status === 'active' || sub.status === 'trialing') {
          // The webhook fills in the rest (plan, period, credit); the id and status now, so a second tap
          // before it lands finds a live plan instead of starting another.
          const { error } = await createAdminClient().from('profiles').update({ terms_accepted_at: new Date().toISOString(), stripe_subscription_id: sub.id, stripe_subscription_status: sub.status }).eq('id', member.id);
          if (error) console.warn('[billing/subscribe] profile stamp failed:', error.message);
          return Response.json({ ok: true, via: 'saved_card', planCode });
        }
        console.warn(`[billing/subscribe] saved-card subscription ${sub.id} is ${sub.status}; falling back to Checkout`);
        if (sub.status === 'incomplete') await stripe.subscriptions.cancel(sub.id).catch(() => undefined);
      } catch (err) {
        const e = err as Error & { code?: string };
        console.warn('[billing/subscribe] saved-card subscription not possible, falling back to Checkout:', e.code ?? e.message);
      }
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
