import { secretsEqual } from '@/lib/crypto/secrets';
import { hasServiceRole } from '@/lib/supabase/admin';
import { initiateSecret } from '@/lib/voice/config';
import { answerInitiation, type InitiationRequest } from '@/lib/voice/inbound-server';
import { callVariables } from '@/lib/voice/agent/variables';

/**
 * Batch 23, Part D: ElevenLabs' conversation-initiation webhook — someone is
 * ringing the Stayful Intelligence number. Authenticated by the x-si-secret
 * header (ELEVENLABS_INITIATE_SECRET, set in ElevenLabs' webhook settings),
 * compared in constant time. Answers with the call's dynamic variables and
 * opener (src/lib/voice/inbound-server.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = initiateSecret();
  if (!secret) return new Response('Not configured', { status: 503 });
  const got = request.headers.get('x-si-secret') ?? '';
  if (!secretsEqual(got, secret)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return new Response('Storage not configured', { status: 503 });
  let body: InitiationRequest;
  try {
    body = (await request.json()) as InitiationRequest;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  try {
    return Response.json(await answerInitiation(body));
  } catch (err) {
    console.error('[voice] initiation failed:', err);
    // Answer anyway, as an unknown caller: never a member's data on a guess.
    // Every variable the agent uses must be sent (Batch 24's knowledge figures too, as "shown in the app").
    return Response.json({ type: 'conversation_initiation_client_data', dynamic_variables: callVariables({ callType: 'callback', context: 'unknown', firstName: null, member: false, cardSent: false, minutesAvailable: 5, topupAmountPence: 2500, topupThresholdPence: 500 }) });
  }
}
