/**
 * Auth for the internal routes (/api/internal/*): Vercel Cron's
 * `Authorization: Bearer $CRON_SECRET`, or the `x-internal-secret` header for
 * manual runs and for n8n. A route with no secret configured should 404
 * rather than run open.
 *
 * Two values are accepted on `x-internal-secret`, at the same trust level:
 *   INTERNAL_API_SECRET  the operator's manual-run secret (stored as a
 *                        sensitive, write-only variable in Vercel);
 *   N8N_SHARED_SECRET    the value n8n holds. It exists so n8n can be given a
 *                        secret without ever reading back or rotating the
 *                        sensitive one. It is also what the site sends on the
 *                        lead-activation webhook (src/lib/auth/sign-in-hooks.ts).
 */
export function internalSecretsConfigured(): boolean {
  return Boolean(process.env.INTERNAL_API_SECRET || process.env.N8N_SHARED_SECRET || process.env.CRON_SECRET);
}

export function authoriseInternal(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const header = request.headers.get('x-internal-secret');
  if (!header) return false;
  for (const secret of [process.env.INTERNAL_API_SECRET, process.env.N8N_SHARED_SECRET]) {
    if (secret && header === secret) return true;
  }
  return false;
}

/** The secret the site sends to n8n on outbound webhooks. */
export function outboundInternalSecret(): string | undefined {
  return process.env.N8N_SHARED_SECRET || process.env.INTERNAL_API_SECRET || undefined;
}
