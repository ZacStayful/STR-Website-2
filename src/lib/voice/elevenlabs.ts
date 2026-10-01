/**
 * Batch 23: ElevenLabs Conversational AI, the pure half — request bodies,
 * webhook payload parsing and the webhook signature check. The network calls
 * are in elevenlabs-server.ts.
 *
 * Checked against the ElevenLabs docs on 1 Oct 2026:
 *   outbound call   POST /v1/convai/twilio/outbound-call
 *                   { agent_id, agent_phone_number_id, to_number,
 *                     conversation_initiation_client_data, telephony_call_config }
 *                   → { success, message, conversation_id, callSid }
 *   webhooks        post_call_transcription, call_initiation_failure,
 *                   answering_machine_detection; header
 *                   ElevenLabs-Signature: t=<unix>,v0=<hex hmac-sha256 of "<t>.<raw body>">
 *   inbound         conversation-initiation webhook (caller_id, agent_id,
 *                   called_number, call_sid, conversation_id) answered with
 *                   { dynamic_variables, conversation_config_override }
 *   agent           PATCH /v1/convai/agents/{agent_id}
 *
 * Pure apart from node:crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ELEVENLABS_API = 'https://api.elevenlabs.io';

/** ElevenLabs' documented tolerance for a webhook's timestamp. */
export const SIGNATURE_TOLERANCE_SECS = 30 * 60;

/**
 * Verify an ElevenLabs-Signature header ("t=<unix>,v0=<hex>[,v0=<hex>]")
 * over the raw body. Any matching v0 passes; a stale or future timestamp fails.
 */
export function verifyElevenLabsSignature(header: string | null, rawBody: string, secret: string, nowSecs: number = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  let t: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    const v = rest.join('=');
    if (k === 't') t = v;
    else if (k === 'v0' && v) sigs.push(v.toLowerCase());
  }
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(nowSecs - Number(t)) > SIGNATURE_TOLERANCE_SECS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'utf8');
  return sigs.some((s) => {
    const got = Buffer.from(s, 'utf8');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** For tests: a valid header for a body. */
export function signElevenLabs(rawBody: string, secret: string, t: number): string {
  return `t=${t},v0=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

export type DynamicVariables = Record<string, string | number | boolean>;

export interface OutboundCallRequest {
  agentId: string;
  phoneNumberId: string;
  to: string;
  dynamicVariables: DynamicVariables;
  firstMessage: string;
}

/** The outbound-call request body: voicemail is detected by Twilio (we hang up, no message). */
export function outboundCallBody(r: OutboundCallRequest): Record<string, unknown> {
  return {
    agent_id: r.agentId,
    agent_phone_number_id: r.phoneNumberId,
    to_number: r.to,
    call_recording_enabled: false,
    conversation_initiation_client_data: {
      dynamic_variables: r.dynamicVariables,
      conversation_config_override: { agent: { first_message: r.firstMessage } },
    },
    telephony_call_config: { twilio_machine_detection: { mode: 'enable' } },
  };
}

export interface OutboundCallResult {
  ok: boolean;
  conversationId: string | null;
  callSid: string | null;
  message: string | null;
}

export function parseOutboundCallResponse(status: number, json: unknown): OutboundCallResult {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const ok = status >= 200 && status < 300 && j.success !== false;
  return { ok, conversationId: str(j.conversation_id), callSid: str(j.callSid) ?? str(j.call_sid), message: str(j.message) ?? (ok ? null : `HTTP ${status}`) };
}

export interface TranscriptTurn {
  role: 'member' | 'agent';
  text: string;
  /** Seconds into the call. */
  at: number | null;
}

export type WebhookEvent =
  | {
      type: 'post_call_transcription';
      conversationId: string;
      callSid: string | null;
      durationSecs: number;
      terminationReason: string | null;
      transcript: TranscriptTurn[];
      /** The data-collection results ElevenLabs filled in (member_unhappy, …). */
      dataCollection: Record<string, unknown>;
      summary: string | null;
      startedAt: Date | null;
      direction: 'inbound' | 'outbound' | null;
    }
  | { type: 'call_initiation_failure'; conversationId: string; callSid: string | null; reason: string }
  | { type: 'answering_machine_detection'; conversationId: string | null; callSid: string | null; answeredBy: string; machine: boolean }
  | { type: 'other'; name: string };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Twilio AnsweredBy values that mean nobody picked up in person. */
export function isMachine(answeredBy: string): boolean {
  return /^(machine|fax)/i.test(answeredBy);
}

export function parseWebhook(json: unknown): WebhookEvent | null {
  const root = obj(json);
  const type = s(root.type);
  const data = obj(root.data);
  if (!type) return null;
  if (type === 'post_call_transcription') {
    const conversationId = s(data.conversation_id);
    if (!conversationId) return null;
    const meta = obj(data.metadata);
    const phone = obj(meta.phone_call);
    const dyn = obj(obj(data.conversation_initiation_client_data).dynamic_variables);
    const analysis = obj(data.analysis);
    const turns: TranscriptTurn[] = [];
    for (const t of Array.isArray(data.transcript) ? data.transcript : []) {
      const o = obj(t);
      const text = s(o.message);
      if (!text) continue;
      turns.push({ role: o.role === 'user' ? 'member' : 'agent', text, at: typeof o.time_in_call_secs === 'number' ? o.time_in_call_secs : null });
    }
    const results = obj(analysis.data_collection_results);
    const dataCollection: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(results)) dataCollection[k] = obj(v).value ?? v;
    const started = typeof meta.start_time_unix_secs === 'number' ? new Date(meta.start_time_unix_secs * 1000) : null;
    const dir = s(phone.direction);
    return {
      type,
      conversationId,
      callSid: s(phone.call_sid) ?? s(dyn.system__call_sid),
      durationSecs: Math.max(0, Math.round(Number(meta.call_duration_secs) || 0)),
      terminationReason: s(meta.termination_reason),
      transcript: turns,
      dataCollection,
      summary: s(analysis.transcript_summary),
      startedAt: started,
      direction: dir === 'inbound' || dir === 'outbound' ? dir : null,
    };
  }
  if (type === 'call_initiation_failure') {
    const conversationId = s(data.conversation_id);
    if (!conversationId) return null;
    const body = obj(obj(data.metadata).body);
    return { type, conversationId, callSid: s(body.CallSid) ?? s(body.call_sid), reason: s(data.failure_reason) ?? 'unknown' };
  }
  if (type === 'answering_machine_detection') {
    const answeredBy = s(data.answered_by) ?? s(data.AnsweredBy) ?? s(data.result) ?? 'unknown';
    return { type, conversationId: s(data.conversation_id), callSid: s(data.call_sid) ?? s(data.CallSid), answeredBy, machine: isMachine(answeredBy) };
  }
  return { type: 'other', name: type };
}

/** How a call that ended with no conversation ended: no answer and busy are "missed". */
export function failureStatus(reason: string): 'missed' | 'failed' {
  return /busy|no[-_ ]?answer|cancel/i.test(reason) ? 'missed' : 'failed';
}
