import 'server-only'

import Stripe from 'stripe'

/**
 * Server-side Stripe client, shared by the webhook and the /account actions.
 *
 * No apiVersion is pinned, matching how the webhook has always constructed it —
 * the account's own default version applies. `subscriptionPeriodEnd` in
 * src/lib/subscription.ts handles both the old and new shapes that produces.
 */
let client: Stripe | null = null

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

/** Throws when unconfigured. Callers that can carry on without billing should
 *  check stripeConfigured() first and degrade rather than catch this. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!client) client = new Stripe(key)
  return client
}
