import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { runFeedbackRetention } from '@/lib/feedback/retention';

/**
 * Nightly feedback run (Batch 18, src/lib/feedback/retention.ts): sends any
 * report email to the admin address that never went, deletes screenshots
 * older than the retention setting (90 days unless changed on
 * /admin/feedback), and deletes the screenshots of reports that have gone.
 * A backlog clears over a few nights rather than timing out.
 *
 * Same auth as the other internal routes. `?dry=1` counts what would be done
 * and changes nothing: no email, no deletion.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/feedback-retention?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const outcome = await runFeedbackRetention({ apply: !dry });
  if (!outcome.ok) {
    console.error('[feedback-retention]', outcome.message);
    return Response.json({ dry, error: outcome.message }, { status: 500 });
  }
  if (outcome.result.schemaMissing) console.warn('[feedback-retention] the Batch 18 section of supabase/schema.sql has not been run; nothing to do');
  if (outcome.result.errors.length > 0) console.error('[feedback-retention]', outcome.result.errors.join('; '));
  return Response.json(outcome.result);
}
