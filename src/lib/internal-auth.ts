/**
 * Auth for the internal routes (/api/internal/*): Vercel Cron's
 * `Authorization: Bearer $CRON_SECRET`, or the `x-internal-secret` header for
 * manual runs and for n8n. A route with no secret configured should 404
 * rather than run open.
 *
 * Two values are accepted on `x-internal-secret`:
 *   INTERNAL_API_SECRET  the operator's manual-run secret (stored as a
 *                        sensitive, write-only variable in Vercel): every route.
 *   N8N_SHARED_SECRET    the value n8n holds. It exists so n8n can be given a
 *                        secret without ever reading back or rotating the
 *                        sensitive one. It is also what the site sends on the
 *                        lead-activation webhook (src/lib/auth/sign-in-hooks.ts).
 *                        Batch 21 (D25): it opens only the routes n8n is meant
 *                        to call, which pass `{ n8n: true }` (lead provisioning);
 *                        not the sends, backfills and sweeps.
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality (Batch 21, C30): a shared secret must not be
 * compared with ===, which returns the instant two bytes differ and so leaks
 * the length of the matching prefix. Mirrors sameHash in src/lib/sms/verify.ts.
 * The length check is not itself constant-time, but a secret's length is not
 * the secret.
 */
function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function internalSecretsConfigured(): boolean {
  return Boolean(process.env.INTERNAL_API_SECRET || process.env.N8N_SHARED_SECRET || process.env.CRON_SECRET);
}

export function authoriseInternal(request: Request, opts: { n8n?: boolean } = {}): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && secretEquals(auth, `Bearer ${cronSecret}`)) return true;
  const header = request.headers.get('x-internal-secret');
  if (!header) return false;
  const accepted = [process.env.INTERNAL_API_SECRET, ...(opts.n8n ? [process.env.N8N_SHARED_SECRET] : [])];
  for (const secret of accepted) {
    if (secret && secretEquals(header, secret)) return true;
  }
  return false;
}

/** The secret the site sends to n8n on outbound webhooks. */
export function outboundInternalSecret(): string | undefined {
  return process.env.N8N_SHARED_SECRET || process.env.INTERNAL_API_SECRET || undefined;
}
