import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endedByVoicemail, failureStatus, outboundCallBody, parseOutboundCallResponse, parseWebhook, signElevenLabs, verifyElevenLabsSignature } from './elevenlabs.ts';

const SECRET = 'wsec_test';
const BODY = '{"type":"post_call_transcription","data":{"conversation_id":"c1"}}';
const NOW = 1_790_000_000;

test('a correctly signed body passes', () => {
  assert.equal(verifyElevenLabsSignature(signElevenLabs(BODY, SECRET, NOW), BODY, SECRET, NOW), true);
  // Any of several v0 values may match.
  const h = signElevenLabs(BODY, SECRET, NOW);
  assert.equal(verifyElevenLabsSignature(`t=${NOW},v0=deadbeef,${h.split(',')[1]}`, BODY, SECRET, NOW), true);
});

test('a tampered body, wrong secret, stale timestamp or missing header fails', () => {
  const h = signElevenLabs(BODY, SECRET, NOW);
  assert.equal(verifyElevenLabsSignature(h, BODY.replace('c1', 'c2'), SECRET, NOW), false);
  assert.equal(verifyElevenLabsSignature(h, BODY, 'other', NOW), false);
  assert.equal(verifyElevenLabsSignature(h, BODY, SECRET, NOW + 31 * 60), false);
  assert.equal(verifyElevenLabsSignature(null, BODY, SECRET, NOW), false);
  assert.equal(verifyElevenLabsSignature('v0=abc', BODY, SECRET, NOW), false);
  assert.equal(verifyElevenLabsSignature(h, BODY, '', NOW), false);
});

test('the outbound-call body asks Twilio to detect machines and overrides only the opener', () => {
  const b = outboundCallBody({ agentId: 'ag', phoneNumberId: 'ph', to: '+447700900123', dynamicVariables: { first_name: 'Sam' }, firstMessage: 'Hi Sam' }) as { to_number: string; call_recording_enabled: boolean; telephony_call_config: { twilio_machine_detection: { mode: string } }; conversation_initiation_client_data: { conversation_config_override: unknown } };
  assert.equal(b.to_number, '+447700900123');
  assert.equal(b.telephony_call_config.twilio_machine_detection.mode, 'enable');
  assert.deepEqual(b.conversation_initiation_client_data.conversation_config_override, { agent: { first_message: 'Hi Sam' } });
  assert.equal(b.call_recording_enabled, false);
});

test('outbound response parsing', () => {
  assert.deepEqual(parseOutboundCallResponse(200, { success: true, conversation_id: 'c', callSid: 'CA1' }), { ok: true, conversationId: 'c', callSid: 'CA1', message: null });
  assert.equal(parseOutboundCallResponse(422, { detail: 'x' }).ok, false);
  assert.equal(parseOutboundCallResponse(200, { success: false, message: 'busy' }).ok, false);
});

test('post-call transcription', () => {
  const e = parseWebhook({
    type: 'post_call_transcription',
    data: {
      conversation_id: 'c1',
      transcript: [{ role: 'agent', message: 'Hi', time_in_call_secs: 0 }, { role: 'user', message: 'Who is this?', time_in_call_secs: 2 }, { role: 'agent', message: null }],
      metadata: { call_duration_secs: 41.6, termination_reason: 'end_call tool', start_time_unix_secs: NOW, phone_call: { direction: 'outbound', call_sid: 'CA1' } },
      analysis: { transcript_summary: 'Intro', data_collection_results: { member_unhappy: { value: false } } },
    },
  });
  assert.ok(e && e.type === 'post_call_transcription');
  assert.equal(e.durationSecs, 42);
  assert.equal(e.callSid, 'CA1');
  assert.equal(e.direction, 'outbound');
  assert.deepEqual(e.transcript, [{ role: 'agent', text: 'Hi', at: 0 }, { role: 'member', text: 'Who is this?', at: 2 }]);
  assert.equal(e.dataCollection.member_unhappy, false);
});

test('initiation failures and answering machines', () => {
  const f = parseWebhook({ type: 'call_initiation_failure', data: { conversation_id: 'c2', failure_reason: 'no-answer', metadata: { type: 'twilio', body: { CallSid: 'CA2' } } } });
  assert.deepEqual(f, { type: 'call_initiation_failure', conversationId: 'c2', callSid: 'CA2', reason: 'no-answer' });
  assert.equal(failureStatus('no-answer'), 'missed');
  assert.equal(failureStatus('busy'), 'missed');
  assert.equal(failureStatus('unknown'), 'failed');
  const m = parseWebhook({ type: 'answering_machine_detection', data: { conversation_id: 'c3', call_sid: 'CA3', answered_by: 'machine_start' } });
  assert.ok(m && m.type === 'answering_machine_detection' && m.machine);
  const h = parseWebhook({ type: 'answering_machine_detection', data: { conversation_id: 'c3', answered_by: 'human' } });
  assert.ok(h && h.type === 'answering_machine_detection' && !h.machine);
  assert.equal(parseWebhook({ type: 'post_call_audio', data: {} })?.type, 'other');
  assert.equal(parseWebhook('nope'), null);
});

test('a call the agent ended on voicemail is voicemail, whatever the transcript says', () => {
  assert.equal(endedByVoicemail('voicemail_detection tool was called'), true);
  assert.equal(endedByVoicemail('Answering machine detected'), true);
  assert.equal(endedByVoicemail('end_call tool'), false);
  assert.equal(endedByVoicemail(null), false);
});
