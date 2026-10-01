import 'server-only';

import Stripe from 'stripe';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  // Batch 21 (G14): the SDK's default is 80 s per request, longer than any of
  // our routes may run; a hung Stripe now fails inside the route's own limit.
  if (!client) client = new Stripe(key, { timeout: 20_000, maxNetworkRetries: 1 });
  return client;
}
