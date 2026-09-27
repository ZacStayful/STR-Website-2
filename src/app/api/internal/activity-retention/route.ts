import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { runRetention } from '@/lib/activity/admin-server';

/**
 * Nightly retention for the activity log (Batch 9, src/lib/activity):
 * deletes events and visits older than 24 months, at most 50,000 of each a
 * night, so a backlog clears over a few nights rather than timing out. The
 * database refuses a cutoff less than a year old, whatever is asked.
 *
 * Same auth as the other internal routes. `?dry=1` counts what would go and
 * deletes nothing.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/activity-retention?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const outcome = await runRetention({ apply: !dry });
  if (!outcome.ok) {
    console.error('[activity-retention]', outcome.message);
    return Response.json({ dry, error: outcome.message }, { status: 500 });
  }
  return Response.json(outcome.result);
}
