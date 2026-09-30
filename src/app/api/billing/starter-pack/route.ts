import type Stripe from 'stripe';
import { currentMember } from '@/lib/credit/auth';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { getBalance } from '@/lib/credit/ledger';
import { priceIdForStarterPack } from '@/lib/stripe/prices';
import { stripeConfigured, getStripe } from '@/lib/stripe/client';
import { ensureStripeCustomer, loadBillingProfile } from '@/lib/stripe/customer';
import { createCheckoutSession, returnUrl } from '@/lib/stripe/checkout';
import { safeInternalPath } from '@/lib/safe-path';
import { logActivity } from '@/lib/activity/log';
import { logConversion } from '@/lib/meta/conversions';
import { clientDetails } from '@/lib/tracking/request';
import { paymentFromIntent } from '@/lib/payments/rules';
import { recordPayment } from '@/lib/payments/server';
import { latestPurchaseFor, starterPackStateFor } from '@/lib/starter-pack/server';
import { grantStarterPack, settleStarterPack, type SettleOutcome } from '@/lib/starter-pack/grant-server';
import { CONSENT_VERSION, returnMessage, type OfferBlock } from '@/lib/starter-pack/rules';

export const dynamic = 'force-dynamic';

/**
 * Batch 20: POST { consent: true, nonce, returnTo? } buys the £10 starter pack.
 * With a saved card it is one click ({ ok, balancePence }); otherwise it
 * returns { url } to Stripe Checkout, which saves the card for one-click
 * top-ups. Either way the card is only authorised: the once-per-person claim
 * decides, then the payment is captured (the credit follows) or cancelled
 * (never charged). The tickbox is required and recorded with the purchase.
 */

const BLOCKED: Record<OfferBlock, string> = {
  off: 'The starter pack is not available right now.',
  existing_member: 'The starter pack is for new members.',
  team_member: 'Billing is managed by your team’s account owner.',
  bought: 'You already have your starter pack.',
  already_had: 'A starter pack has already been used with this email address or mobile number (one per person).',
  on_plan: 'You are on a plan, so the starter pack is not needed.',
};

// The Stripe price is checked against the setting (so what is charged is what the member was told), a few minutes at a time.
let priceCheck: { id: string; amount: number | null; at: number } | null = null;
async function stripePriceAmount(priceId: string): Promise<number | null> {
  if (priceCheck && priceCheck.id === priceId && Date.now() - priceCheck.at < 5 * 60_000) return priceCheck.amount;
  const price = await getStripe().prices.retrieve(priceId);
  const amount = price.currency === 'gbp' && price.type === 'one_time' ? (price.unit_amount ?? null) : null;
  priceCheck = { id: priceId, amount, at: Date.now() };
  return amount;
}

export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (member.teamMember) return Response.json({ error: BLOCKED.team_member }, { status: 403 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet. Email hello@stayful.co.uk.' }, { status: 503 });

  let body: { consent?: unknown; nonce?: unknown; returnTo?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (body.consent !== true) return Response.json({ error: 'Tick the box to confirm you want to use your credit straight away.' }, { status: 400 });
  const nonce = typeof body.nonce === 'string' && /^[0-9a-f-]{8,64}$/i.test(body.nonce) ? body.nonce : crypto.randomUUID();
  const back = safeInternalPath(typeof body.returnTo === 'string' ? body.returnTo : null, '/today');

  const state = await starterPackStateFor(member.id);
  if (!state.offer.eligible) return Response.json({ error: BLOCKED[state.offer.reason] }, { status: 409 });

  const priceId = priceIdForStarterPack();
  if (!priceId) return Response.json({ error: 'The starter pack is not configured yet (missing Stripe price).' }, { status: 503 });
  const settings = await getBillingSettings();
  const lc = settings.lifecycle;
  try {
    const amount = await stripePriceAmount(priceId);
    if (amount !== lc.starterPackPricePence) {
      console.error(`[billing/starter-pack] Stripe price ${priceId} is ${amount ?? 'not a one-off GBP price'}, but starter_pack_price_pence is ${lc.starterPackPricePence}: refusing to sell`);
      return Response.json({ error: 'The starter pack is not available right now.' }, { status: 503 });
    }
  } catch (err) {
    console.error('[billing/starter-pack] price check failed:', (err as Error)?.message ?? err);
    return Response.json({ error: "Couldn't start the payment. Please try again." }, { status: 502 });
  }

  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });
  const metadata = {
    user_id: member.id,
    kind: 'starter_pack',
    price_pence: String(lc.starterPackPricePence),
    credit_pence: String(lc.starterPackCreditPence),
    consent_at: new Date().toISOString(),
    consent_version: CONSENT_VERSION,
  };

  try {
    const stripe = getStripe();
    const customer = await ensureStripeCustomer(profile, member.email);

    // One click on a saved card: authorised, settled (claimed and captured, or cancelled), then granted.
    if (profile.stripe_default_payment_method_id) {
      let pi: Stripe.PaymentIntent | null = null;
      try {
        pi = await stripe.paymentIntents.create(
          {
            amount: lc.starterPackPricePence,
            currency: 'gbp',
            customer,
            payment_method: profile.stripe_default_payment_method_id,
            off_session: true,
            confirm: true,
            capture_method: 'manual',
            description: `Stayful starter pack: ${state.copy.credit} of credit`,
            metadata,
          },
          { idempotencyKey: `starter_pack:${member.id}:${nonce}` },
        );
      } catch (err) {
        const e = err as Error & { code?: string };
        console.warn('[billing/starter-pack] off-session authorisation failed, falling back to Checkout:', e.code ?? e.message);
      }
      if (pi && pi.status === 'requires_capture') {
        let settled: SettleOutcome;
        try {
          settled = await settleStarterPack(pi.id);
        } catch (err) {
          // Authorised and held for them, but not settled: the webhook finishes it (captured, or let go if it cannot be).
          console.error('[billing/starter-pack] settle failed:', (err as Error)?.message ?? err);
          return Response.json({ error: `We couldn't confirm your payment just now. If it goes through, your ${state.copy.credit} of credit appears within a few minutes, so please don't pay again.` }, { status: 502 });
        }
        if (settled === 'captured' || settled === 'already') {
          try {
            const captured = await stripe.paymentIntents.retrieve(pi.id);
            const outcome = await grantStarterPack({ paymentIntent: captured, email: member.email });
            if (outcome === 'granted' || outcome === 'already') {
              await recordPayment(paymentFromIntent(captured, member.id));
              logActivity(member.id, 'starter_pack', { dedupeKey: `starter_pack:pi:${pi.id}`, extras: { amount_pence: lc.starterPackPricePence } });
              // Meta's Purchase with the member's own browser (the webhook's copy has the same key: one is sent).
              await logConversion({ name: 'Purchase', userId: member.id, eventId: pi.id, paymentIntentId: pi.id, topup: { kind: 'topup', auto: null, amountPence: lc.starterPackPricePence, currency: 'gbp' }, details: clientDetails(request.headers) });
              const bal = await getBalance(member.id);
              return Response.json({ ok: true, balancePence: bal.totalPence, via: 'saved_card' });
            }
          } catch (err) {
            // Paid: the webhook's payment_intent.succeeded grants it. Never tell a charged member it failed.
            console.error('[billing/starter-pack] grant after capture failed (the webhook will grant it):', (err as Error)?.message ?? err);
            return Response.json({ ok: true, pending: true, via: 'saved_card' });
          }
        }
        const attempt = await latestPurchaseFor(member.id);
        const msg = settled === 'blocked' || settled === 'blocked_charged' ? returnMessage('blocked', attempt?.blockedBy ?? 'card', state.copy.credit) : returnMessage('failed', null, state.copy.credit);
        return Response.json({ error: msg?.text ?? 'The starter pack could not be bought.' }, { status: 409 });
      }
      // Needs the member (3-D Secure) or was declined: let go of it and use Checkout.
      if (pi && pi.status !== 'canceled') await stripe.paymentIntents.cancel(pi.id).catch(() => undefined);
    }

    const session = await createCheckoutSession({
      mode: 'payment',
      customer,
      client_reference_id: member.id,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_intent_data: { capture_method: 'manual', setup_future_usage: 'off_session', description: `Stayful starter pack: ${state.copy.credit} of credit`, metadata },
      metadata,
      custom_text: { submit: { message: state.copy.checkoutText } },
      success_url: returnUrl('/today', { pack: '1' }),
      cancel_url: returnUrl(back),
      ...(process.env.STRIPE_TAX === 'true' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    });
    return Response.json({ url: session.url, via: 'checkout' });
  } catch (err) {
    console.error('[billing/starter-pack] failed:', err);
    return Response.json({ error: "Couldn't start the payment. Please try again." }, { status: 502 });
  }
}
