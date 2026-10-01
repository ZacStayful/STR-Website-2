import 'server-only';

/**
 * Batch 23: the ElevenLabs network calls — place an outbound call; read and
 * write the agent and its tools (the sync from src/lib/voice/agent).
 */
import { ELEVENLABS_API, outboundCallBody, parseOutboundCallResponse, type OutboundCallRequest, type OutboundCallResult } from './elevenlabs';

const TIMEOUT_MS = 15_000;

export async function placeOutboundCall(apiKey: string, r: OutboundCallRequest): Promise<OutboundCallResult> {
  try {
    const res = await fetch(`${ELEVENLABS_API}/v1/convai/twilio/outbound-call`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(outboundCallBody(r)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    const out = parseOutboundCallResponse(res.status, json);
    if (!out.ok) console.error('[voice] outbound call refused:', res.status, out.message);
    return out;
  } catch (err) {
    console.error('[voice] outbound call failed:', err);
    return { ok: false, conversationId: null, callSid: null, message: 'network' };
  }
}

export async function elevenLabsJson(apiKey: string, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await fetch(`${ELEVENLABS_API}${path}`, {
      method,
      headers: { 'xi-api-key': apiKey, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  } catch (err) {
    return { ok: false, status: 0, json: { error: String((err as Error)?.message ?? err) } };
  }
}
