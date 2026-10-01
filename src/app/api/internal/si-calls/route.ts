import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { emailKey } from '@/lib/supabase/email-key';
import { runCalls } from '@/lib/voice/run';

/**
 * Batch 23: the Stayful Intelligence calls cron, every 5 minutes
 * (src/lib/voice/run.ts): intros owed, due calls placed (weekdays 9am–7pm UK,
 * every safety rule re-checked), calls with no webhook reconciled, and the
 * daily transcript purge.
 *
 * Same auth as the other internal routes. `?dry=1` reports what would be
 * done and changes nothing: no call, no text, no email, no charge, no row.
 * `?only=<email>` limits the pass to one member.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/si-calls?dry=1"
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
  const result = await runCalls({ apply: !dry, onlyUserId });
  if (result.schemaMissing) console.warn('[si-calls] the Batch 23 section of supabase/schema.sql has not been run; nothing to do');
  if (result.errors.length > 0) console.error('[si-calls]', result.errors.join('; '));
  return Response.json(result);
}
