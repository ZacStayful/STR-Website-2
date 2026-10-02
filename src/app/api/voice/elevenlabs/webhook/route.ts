import { hasServiceRole } from '@/lib/supabase/admin';
import { webhookSecret } from '@/lib/voice/config';
import { parseWebhook, verifyElevenLabsSignature } from '@/lib/voice/elevenlabs';
import { handleWebhookEvent } from '@/lib/voice/webhook-server';

/**
 * Batch 23: ElevenLabs' post-call webhook (post_call_transcription,
 * call_initiation_failure, answering_machine_detection). Every request must
 * carry a valid ElevenLabs-Signature over the raw body (HMAC-SHA256 with
 * ELEVENLABS_WEBHOOK_SECRET, within 30 minutes); anything else is refused
 * before a field is read. Each event is processed once
 * (si_webhook_events): a redelivery never charges or texts twice.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) return new Response('Not configured', { status: 503 });
  const raw = await request.text();
  if (!verifyElevenLabsSignature(request.headers.get('elevenlabs-signature'), raw, secret)) return new Response('Bad signature', { status: 401 });
  if (!hasServiceRole()) return new Response('Storage not configured', { status: 503 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const event = parseWebhook(json);
  if (!event) return Response.json({ ignored: true });
  const r = await handleWebhookEvent(event);
  return Response.json(r.body, { status: r.status });
}
