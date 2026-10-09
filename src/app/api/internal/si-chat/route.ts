import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { anonymiseChat } from '@/lib/chat/log-server';

/**
 * Nightly (Batch 26, src/lib/chat): the typed chat's 90-day rule. Past
 * si_transcript_retention_days (Batch 23's 90) a chat question keeps its
 * text and outcome for learning but loses the member's name, on the
 * conversation and on chat_turns. The transcript itself is deleted by Batch
 * 23's purgeTranscripts (the si-calls cron), for every channel. At most 1,000
 * of each a night, so a backlog clears over a few nights.
 *
 * Same auth as the other internal routes. `?dry=1` counts and changes nothing.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/si-chat?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  const days = (await getBillingSettings()).voice.transcriptRetentionDays;
  try {
    const result = await anonymiseChat({ apply: !dry, days });
    return Response.json({ dry, days, ...result });
  } catch (err) {
    console.error('[si-chat]', (err as Error)?.message ?? err);
    return Response.json({ dry, error: (err as Error)?.message ?? 'failed' }, { status: 500 });
  }
}
