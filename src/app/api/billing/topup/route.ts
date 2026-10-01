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
import { logActivity } from '@/lib/activity/log';
import { logConversion } from '@/lib/meta/conversions';
import { clientDetails } from '@/lib/tracking/request';
import { paymentFromIntent } from '@/lib/payments/rules';
import { recordPayment } from '@/lib/payments/server';
import { resumeReturnFor } from '@/lib/billing/resume-server';

export const dynamic = 'force-dynamic';
// Batch 21 (G14): the Stripe client gives up at 20 s; the route stops before the platform does.
export const maxDuration = 30;

/**
 * POST { amountPence, nonce } → { ok, balancePence } after a one-click charge
 * on the saved card, or { url } to Stripe Checkout (which saves the card).
 */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  // The team's owner pays and buys; a member cannot spend on their card.
  if (member.teamMember) return Response.json({ error: 'Billing is managed by your team’s account owner.' }, { status: 403 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet. Email hello@stayful.co.uk to top up.' }, { status: 503 });

  let body: { amountPence?: unknown; nonce?: unknown; via?: unknown; resume?: unknown; autoTopup?: unknown };
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
  // Batch 20, Part B: the top-up chosen from the low-credit decision (weekly active).
  if (body.via === 'low_credit') logActivity(member.id, 'low_credit_topup', { dedupeKey: `low_credit_topup:${new Date().toISOString().slice(0, 10)}`, extras: { amount_pence: amount } });

  const resumeBack = typeof body.resume === 'string' ? await resumeReturnFor(member.id, body.resume) : null;
  // Batch 23: Stayful Intelligence's auto top-up link, with no saved card — this
  // checkout saves the card and the webhook switches auto top-up on (only at the
  // link's own amount and trigger, and only if it is still off).
  const autoTopup = body.autoTopup === true && amount === settings.intelligence.revealAutoTopupAmountPence;
  const autoMeta: Record<string, string> = autoTopup ? { auto_topup_on: '1', auto_topup_threshold_pence: String(Math.round(settings.intelligence.revealAutoTopupThresholdPence)) } : {};
  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });

  try {
    const stripe = getStripe();
    const customer = await ensureStripeCustomer(profile, member.email);

    // Batch 23: with a card already saved, the auto top-up link switches it on without charging (/api/billing/auto-topup).
    if (autoTopup && profile.stripe_default_payment_method_id) return Response.json({ error: 'You already have a saved card: turn auto top-up on instead.', savedCard: true }, { status: 409 });

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
          // Batch 21 (B7): the card has been charged. Nothing from here may
          // fall back to Checkout (a second charge) or report a failure (a
          // second tap): the webhook grants it if any of this fails.
          try {
            // The webhook will also arrive; grantTopup is idempotent on pi id.
            await grantTopup(member.id, amount, `pi:${pi.id}`, { email: member.email });
            // Batch 20: what was charged, for Total paid (the webhook writes the same row, once).
            await recordPayment(paymentFromIntent(pi, member.id));
            logActivity(member.id, 'topup', { dedupeKey: `topup:pi:${pi.id}`, extras: { amount_pence: amount } });
            // Batch 19: Meta's Purchase, with the member's own browser (the webhook's copy is the same key: one is sent).
            await logConversion({ name: 'Purchase', userId: member.id, eventId: pi.id, paymentIntentId: pi.id, topup: { kind: 'topup', auto: null, amountPence: amount, currency: pi.currency }, details: clientDetails(request.headers) });
            const bal = await getBalance(member.id);
            return Response.json({ ok: true, balancePence: bal.totalPence, via: 'saved_card' });
          } catch (err) {
            console.error('[billing/topup] charged but not yet granted (the webhook will grant it):', (err as Error)?.message ?? err);
            return Response.json({ ok: true, pending: true, via: 'saved_card' });
          }
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
      payment_intent_data: { setup_future_usage: 'off_session', metadata: { user_id: member.id, kind: 'topup', amount_pence: String(amount), ...autoMeta } },
      metadata: { user_id: member.id, kind: 'topup', amount_pence: String(amount), ...autoMeta },
      // Batch 22: a resume intent sends the member back to what they were buying (their own intent, an internal path).
      success_url: resumeBack ? returnUrl(resumeBack, { topup: '1', resume: String(body.resume) }) : autoTopup ? returnUrl('/account/billing/auto-topup', { done: '1' }) : returnUrl('/account/billing', { topup: '1' }),
      cancel_url: returnUrl(resumeBack ?? (autoTopup ? '/account/billing/auto-topup' : '/account/billing')),
      ...(process.env.STRIPE_TAX === 'true' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } } : {}),
    });
    return Response.json({ url: session.url, via: 'checkout' });
  } catch (err) {
    console.error('[billing/topup] failed:', err);
    return Response.json({ error: "Couldn't complete the top-up. Please try again." }, { status: 502 });
  }
}
