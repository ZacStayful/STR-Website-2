/**
 * Auth for the internal cron routes (/api/internal/*): Vercel Cron's
 * `Authorization: Bearer $CRON_SECRET`, or the shared `x-internal-secret`
 * header for manual runs. A route with neither secret configured should
 * 404 rather than run open.
 */
export function internalSecretsConfigured(): boolean {
  return Boolean(process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET);
}

export function authoriseInternal(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret && request.headers.get('x-internal-secret') === secret) return true;
  return false;
}
