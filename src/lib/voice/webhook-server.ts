import 'server-only';

/**
 * Batch 23: what an ElevenLabs webhook does, once per event (si_webhook_events
 * claims it first; a redelivery is a no-op):
 *   post_call_transcription      the call's outcome, its length, the
 *                                transcript into the conversation log, and
 *                                the answered minutes charged once
 *   call_initiation_failure      busy / no answer → missed (+ the missed-call
 *                                text and email); anything else → failed
 *   answering_machine_detection  a machine → hang up at once, no message,
 *                                treated as missed (voicemail)
 *
 * "Answered" means the member said something: a call nobody spoke on is
 * treated as missed (free, with the fallback), so a voicemail the detector
 * missed is never charged.
 */
import { createAdminClient } from '../supabase/admin';
import { addTurns, closeConversation, hasOutcome, recordQuestion, startConversation } from '../conversations/log-server';
import { endedByVoicemail, failureStatus, type WebhookEvent } from './elevenlabs';
import { chargeCallMinutes } from './charge-server';
import { sendMissedCallFallback } from './fallback-server';
import { hangUp } from './twilio-voice';
import { callById, callByConversation, claimEvent, finishEvent, updateCall, type CallRow } from './store-server';

export type HandleResult = { status: number; body: Record<string, unknown> };

/** An event that arrived before what it is about: answered 409, so the provider redelivers it. */
class RetryLater extends Error {}

const PROVIDER = 'elevenlabs';

function eventKey(e: WebhookEvent): string | null {
  if (e.type === 'other') return null;
  return `${e.type}:${e.conversationId ?? e.callSid ?? ''}`;
}

export async function handleWebhookEvent(e: WebhookEvent): Promise<HandleResult> {
  const key = eventKey(e);
  if (!key || key.endsWith(':')) return { status: 200, body: { ignored: e.type === 'other' ? e.name : 'no id' } };
  const admin = createAdminClient();
  const claim = await claimEvent(admin, PROVIDER, key);
  if (claim === 'done') return { status: 200, body: { duplicate: true } };
  if (claim === 'busy') return { status: 409, body: { busy: true } };
  if (claim === 'unavailable') return { status: 503, body: { error: 'unavailable' } };
  try {
    const result = await dispatch(e);
    await finishEvent(admin, PROVIDER, key, null);
    return { status: 200, body: result };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    await finishEvent(admin, PROVIDER, key, message);
    if (err instanceof RetryLater) return { status: 409, body: { retry: message } };
    console.error('[voice] webhook failed:', message);
    return { status: 500, body: { error: 'failed' } };
  }
}

async function dispatch(e: WebhookEvent): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  if (e.type === 'answering_machine_detection') {
    const call = await callByConversation(admin, e.conversationId, e.callSid);
    if (!call) {
      if (!e.machine) return { human: true };
      throw new RetryLater('call not recorded yet');
    }
    if (!e.machine) return { human: true };
    const sid = e.callSid ?? call.twilio_call_sid;
    if (sid) await hangUp(sid);
    const updated = await updateCall(admin, call.id, { status: 'voicemail', ended_at: new Date().toISOString(), seconds: 0 }, ['ringing', 'queued']);
    if (updated) await sendMissedCallFallback(updated);
    return { voicemail: true };
  }
  if (e.type === 'call_initiation_failure') {
    const call = await callByConversation(admin, e.conversationId, e.callSid);
    // A busy line can answer before the call's ids are saved: let ElevenLabs deliver it again.
    if (!call) throw new RetryLater('call not recorded yet');
    const status = failureStatus(e.reason);
    const updated = await updateCall(admin, call.id, { status, ended_at: new Date().toISOString(), seconds: 0, error: e.reason.slice(0, 200) }, ['ringing', 'queued']);
    if (updated && status === 'missed') await sendMissedCallFallback(updated);
    return { status };
  }
  if (e.type === 'post_call_transcription') {
    const call = await callByConversation(admin, e.conversationId, e.callSid);
    if (!call) throw new RetryLater('call not recorded yet');
    return finishCall(call, e);
  }
  return { ignored: true };
}

async function finishCall(first: CallRow, e: Extract<WebhookEvent, { type: 'post_call_transcription' }>): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  // Re-read: the machine-detection webhook may have marked it voicemail meanwhile.
  const call = (await callById(admin, first.id)) ?? first;
  const memberSpoke = e.transcript.some((t) => t.role === 'member' && t.text.trim().length > 0);
  // Voicemail (Twilio's detector, or the agent's) is never answered; nobody speaking is missed.
  const voicemail = call.status === 'voicemail' || (call.direction === 'outbound' && endedByVoicemail(e.terminationReason));
  const status = voicemail ? 'voicemail' : memberSpoke && e.durationSecs > 0 ? 'answered' : 'missed';
  const startedAt = e.startedAt ?? (call.placed_at ? new Date(call.placed_at) : new Date());
  const seconds = status === 'answered' ? e.durationSecs : 0;

  // The conversation log, channel 'call' (Batch 24 learns from it).
  let conversationId = call.conversation_id;
  if (!conversationId && e.transcript.length > 0) {
    conversationId = await startConversation({ channel: 'call', userId: call.user_id, startedAt });
  }
  if (conversationId) {
    await addTurns(conversationId, e.transcript.map((t) => ({ role: t.role, text: t.text, at: t.at !== null ? new Date(startedAt.getTime() + t.at * 1000) : startedAt })));
    // ElevenLabs' analysis flags an unhappy member the agent did not log itself.
    const unhappy = e.dataCollection.member_unhappy;
    if ((unhappy === true || unhappy === 'true') && !(await hasOutcome(conversationId, 'member_unhappy'))) {
      const lastQ = [...e.transcript].reverse().find((t) => t.role === 'member')?.text ?? 'Unhappy with an answer';
      await recordQuestion(conversationId, { question: lastQ, outcome: 'member_unhappy', source: 'analysis' });
    }
    await closeConversation(conversationId, new Date(startedAt.getTime() + e.durationSecs * 1000));
  }

  const updated = await updateCall(admin, call.id, {
    status,
    seconds,
    started_at: startedAt.toISOString(),
    ended_at: new Date(startedAt.getTime() + e.durationSecs * 1000).toISOString(),
    conversation_id: conversationId,
    ...(e.callSid && !call.twilio_call_sid ? { twilio_call_sid: e.callSid } : {}),
  }, status === 'voicemail' ? ['ringing', 'queued', 'voicemail'] : ['ringing', 'queued']);

  // Answered minutes, once (the guard key), only for a recognised member, and only if this update won.
  let charged = 0;
  if (updated && updated.status === 'answered' && call.user_id && seconds > 0) {
    charged = (await chargeCallMinutes(call.id, call.user_id, seconds)).charged;
  }
  if (updated && status !== 'answered' && call.direction === 'outbound') await sendMissedCallFallback(updated);
  return { status, seconds, charged };
}
