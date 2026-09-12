import { currentMember } from '@/lib/credit/auth';
import { stripeConfigured, getStripe } from '@/lib/stripe/client';
import { ensureStripeCustomer, loadBillingProfile } from '@/lib/stripe/customer';
import { returnUrl } from '@/lib/stripe/checkout';

export const dynamic = 'force-dynamic';

/** POST → { url } to the Stripe customer portal (change plan, cancel, update card, invoices). */
export async function POST() {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!stripeConfigured()) return Response.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });
  try {
    const customer = await ensureStripeCustomer(profile, member.email);
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: returnUrl('/account/billing'),
      ...(process.env.STRIPE_PORTAL_CONFIG_ID ? { configuration: process.env.STRIPE_PORTAL_CONFIG_ID } : {}),
    });
    return Response.json({ url: session.url });
  } catch (err) {
    console.error('[billing/portal] failed:', err);
    return Response.json({ error: "Couldn't open the billing portal. Please try again." }, { status: 502 });
  }
}
