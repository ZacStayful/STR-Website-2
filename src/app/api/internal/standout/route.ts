import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { emailKey } from '@/lib/supabase/email-key';
import { runStandout } from '@/lib/standout/run';

/**
 * Batch 25: the standout pass (src/lib/standout/run.ts), hourly at :35 (after
 * the :30 recheck makes new deals live) and at 06:58 (after the morning
 * sweeps, before the 07:00 Today lists): new deals judged against each
 * account owner's primary profile, standouts saved to My deals, deal calls
 * queued (Batch 23's queue places them, weekdays 9am–7pm UK), texts and
 * emails for members below the call floor, and any slower-spender nudge.
 *
 * Off until STANDOUT_ENABLED=true; a dry run works either way. `?dry=1`
 * reads everything and writes nothing: no save, no call, no text, no email,
 * no charge, no row — it lists every decision with its reason.
 * `?only=<email>` limits the pass to one member (and never moves the
 * watermarks).
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/standout?dry=1"
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });
  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  let onlyUserId: string | null = null;
  const only = url.searchParams.get('only');
  if (only) {
    const { data } = await createAdminClient().from('profiles').select('id').eq('email', emailKey(only)).maybeSingle();
    if (!data) return Response.json({ dry, error: 'no member with that email' }, { status: 404 });
    onlyUserId = String((data as { id: string }).id);
  }
  const result = await runStandout({ apply: !dry, onlyUserId, kind: 'cron' });
  if (result.schemaMissing) console.warn('[standout] the Batch 25 section of supabase/schema.sql has not been run; nothing to do');
  if (result.errors.length > 0) console.error('[standout]', result.errors.join('; '));
  return Response.json(result);
}
