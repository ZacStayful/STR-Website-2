import 'server-only';

import type Stripe from 'stripe';
import { getStripe } from './client';
import { siteUrl } from '../url';

/**
 * Creates a Checkout Session, asking for terms-of-service consent when the
 * Stripe account has a terms URL configured (Stripe rejects the parameter
 * otherwise, so we retry without it rather than block payment).
 */
export async function createCheckoutSession(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const withConsent: Stripe.Checkout.SessionCreateParams = process.env.STRIPE_TERMS_CONSENT === 'false' ? params : { ...params, consent_collection: { terms_of_service: 'required' } };
  try {
    return await stripe.checkout.sessions.create(withConsent);
  } catch (err) {
    const msg = String((err as Error)?.message ?? '');
    if (withConsent.consent_collection && /terms_of_service|terms of service/i.test(msg)) {
      console.warn('[stripe] terms consent unavailable (set a Terms of Service URL in the Stripe Dashboard); continuing without it');
      return await stripe.checkout.sessions.create(params);
    }
    throw err;
  }
}

export function returnUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(siteUrl(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
