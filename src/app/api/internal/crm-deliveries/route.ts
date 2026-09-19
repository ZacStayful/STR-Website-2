import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { drainDeliveries } from '@/lib/crm/deliver';

/**
 * Drains the CRM delivery queue.
 *
 * A push is never made inline with the prospect's request — their CRM being
 * down must not leave a stranger waiting, and must never cost the customer
 * the lead. The lead is already safely stored by the time anything reaches
 * this queue; the delivery is the copy, and it retries with backoff.
 *
 * Same auth as every other internal route: Vercel Cron's bearer or the
 * shared header. This one sends a customer's prospects' personal data to a
 * third party, so it never runs open.
 */

export const maxDuration = 60;

/** Each Monday delivery renders a PDF, and there are sixty seconds. */
const MAX_PER_RUN = 10;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const started = Date.now();
  const summary = await drainDeliveries(MAX_PER_RUN);
  return Response.json({ ...summary, ms: Date.now() - started });
}
