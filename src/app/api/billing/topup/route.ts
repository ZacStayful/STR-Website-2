import { after } from 'next/server';
import { currentMember } from '@/lib/credit/auth';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { getBalance } from '@/lib/credit/ledger';
import { priceIdForTopup } from '@/lib/stripe/prices';
import { stripeConfigured, getStripe } from '@/lib/stripe/client';
import { ensureStripeCustomer, loadBillingProfile } from '@/lib/stripe/customer';
import { grantTopup } from '@/lib/stripe/grants';
import { createCheckoutSession, returnUrl } from '@/lib/stripe/checkout';
import { createAdminClient } from '@/lib/supabase/admin';
import { cardNeedsUpdateEmail } from '@/lib/email/billing';

export const dynamic = 'force-dynamic';

/**
 * POST { amountPence, nonce } → { ok, balancePence } after a one-click charge
 * on the saved card, or { url } to Stripe Checkout (which saves the card).
 */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet. Email hello@stayful.co.uk to top up.' }, { status: 503 });

  let body: { amountPence?: unknown; nonce?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const settings = await getBillingSettings();
  const amount = Number(body.amountPence);
  if (!settings.topupPresetsPence.includes(amount)) return Response.json({ error: 'Choose one of the top-up amounts.' }, { status: 400 });
  const priceId = priceIdForTopup(amount);
  const nonce = typeof body.nonce === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.nonce) ? body.nonce : crypto.randomUUID();

  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });

  try {
    const stripe = getStripe();
    const customer = await ensureStripeCustomer(profile, member.email);

    // One click: a saved card, charged off-session.
    if (profile.stripe_default_payment_method_id) {
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount,
            currency: 'gbp',
            customer,
            payment_method: profile.stripe_default_payment_method_id,
            off_session: true,
            confirm: true,
            description: `Stayful credit top-up £${(amount / 100).toFixed(2)}`,
            metadata: { user_id: member.id, kind: 'topup', amount_pence: String(amount) },
          },
          { idempotencyKey: `topup:${member.id}:${nonce}` },
        );
        if (pi.status === 'succeeded') {
          // The webhook will also arrive; grantTopup is idempotent on pi id.
          await grantTopup(member.id, amount, `pi:${pi.id}`, { email: member.email });
          const bal = await getBalance(member.id);
          return Response.json({ ok: true, balancePence: bal.totalPence, via: 'saved_card' });
        }
        // requires_action etc.: fall through to Checkout so the member can authenticate.
      } catch (err) {
        const e = err as Error & { code?: string; decline_code?: string };
        console.warn('[billing/topup] off-session charge failed, falling back to Checkout:', e.code ?? e.message);
        if (e.code === 'card_declined' || e.code === 'expired_card' || e.code === 'authentication_required') {
          after(async () => {
            await createAdminClient().from('profiles').update({ auto_topup_amount_pence: null }).eq('id', member.id);
            if (member.email) await cardNeedsUpdateEmail(member.email);
          });
        }
      }
    }

    if (!priceId) return Response.json({ error: 'Top-ups are not configured yet (missing Stripe price).' }, { status: 503 });
    const session = await createCheckoutSession({
      mode: 'payment',
      customer,
      client_reference_id: member.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_intent_data: { setup_future_usage: 'off_session', metadata: { user_id: member.id, kind: 'topup', amount_pence: String(amount) } },
      metadata: { user_id: member.id, kind: 'topup', amount_pence: String(amount) },
      success_url: returnUrl('/account/billing', { topup: '1' }),
      cancel_url: returnUrl('/account/billing'),
      ...(process.env.STRIPE_TAX === 'true' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    });
    return Response.json({ url: session.url, via: 'checkout' });
  } catch (err) {
    console.error('[billing/topup] failed:', err);
    return Response.json({ error: "Couldn't complete the top-up. Please try again." }, { status: 502 });
  }
}
