/**
 * Which signing secrets a webhook delivery may be verified against.
 *
 * Stripe signs each delivery with the secret belonging to the endpoint it came
 * from, so an account with more than one endpoint needs more than one secret.
 * Holding several and trying each is the pattern Stripe documents for exactly
 * this, and for rotating a secret without a window of failed deliveries.
 *
 * Pure and injectable — Stripe is a type-only import, erased at runtime — so
 * the native type-stripping test runner can load this without the SDK.
 */
import type Stripe from 'stripe';

/** The env var names read, in the order they are tried. */
export const SECRET_VARS = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET2'] as const;

/**
 * Every signing secret this deployment should accept.
 *
 * Each variable may also hold several secrets separated by commas or
 * whitespace, which is what lets the next endpoint or rotation be a
 * configuration change with no code change at all.
 */
export function webhookSecrets(env: Record<string, string | undefined>): string[] {
  const seen = new Set<string>();
  for (const name of SECRET_VARS) {
    for (const part of (env[name] ?? '').split(/[,\s]+/)) {
      const secret = part.trim();
      if (secret) seen.add(secret);
    }
  }
  return [...seen];
}

export interface VerifiedWebhook {
  event: Stripe.Event;
  /**
   * Which secret matched, 1-based. Logged so two endpoints can be told apart
   * in the runtime logs — the position, never the secret itself. That is how
   * we know when an old endpoint has gone quiet and is safe to delete.
   */
  position: number;
}

/**
 * The verified event, or null when no configured secret matches.
 *
 * Returns null rather than throwing for every rejection — a missing header, a
 * forged signature, no secrets configured — so the caller has one path for
 * "not from Stripe" and cannot accidentally surface a Stripe error to the
 * sender. Each attempt is a full HMAC check, so trying several is no weaker
 * than trying one.
 */
export function verifyWebhook(
  stripe: Pick<Stripe, 'webhooks'>,
  rawBody: string,
  signature: string | null,
  secrets: string[],
): VerifiedWebhook | null {
  if (!signature) return null;

  for (const [i, secret] of secrets.entries()) {
    try {
      return { event: stripe.webhooks.constructEvent(rawBody, signature, secret), position: i + 1 };
    } catch {
      // Wrong secret for this endpoint, or not from Stripe at all. Try the next.
    }
  }
  return null;
}
