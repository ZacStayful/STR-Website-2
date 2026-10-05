import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE, CHANNELS } from '../../persona/stayful-intelligence.ts';
import { agentPrompt } from './prompt.ts';
import { agentKnowledge, KNOWLEDGE_VARIABLES, promptVariables } from '../../knowledge/agent.ts';
import { SEED } from '../../knowledge/seed.ts';
import { schemaSnapshot } from '../../knowledge/test-fixtures.ts';
import { toolConfig } from './tools.ts';
import { agentConfig, INITIATE_SECRET_HEADER, pickPostCallWebhook, POST_CALL_EVENTS } from './agent-config.ts';
import { parseWebhook } from '../elevenlabs.ts';
import { TOOL_NAMES } from '../config.ts';
import { callVariables, fill, openerFor, VARIABLE_NAMES } from './variables.ts';

// Batch 24: the knowledge is the knowledge base's call answers (here the seed, as if all approved).
const live = SEED.map((e, i) => ({ ...e, id: `id-${i}`, version: 1 }));
const knowledge = agentKnowledge(live, schemaSnapshot()).text;

test('the phone agent\'s instructions are built from the persona module (CORE + phone)', () => {
  const p = agentPrompt(knowledge);
  for (const r of CORE) assert.ok(p.includes(r.full), `missing CORE ${r.id}`);
  for (const r of CHANNELS.phone) assert.ok(p.includes(r.full), `missing phone ${r.id}`);
  for (const r of CHANNELS.chat) assert.ok(!p.includes(r.full), 'chat rules on the phone');
  // The phone's no-address / no-figures rule.
  assert.match(p, /Never read out an address, exact figures, a balance or card details/);
  assert.match(p, /I don't know that one yet — I've passed it to the team/);
  // The intro script is in, verbatim.
  assert.match(p, /I'll only call when there's something worth your time/);
});

test('the knowledge carries a slug per entry and its figures as call variables, never typed', () => {
  assert.match(knowledge, /\[calls_how\] .*\{\{k_call_minute_cost\}\} a minute/);
  assert.match(knowledge, /\[what_it_costs\]/);
  assert.match(knowledge, /\[forecast_accuracy\]/);
  // No figure is written into the prompt: every one is a variable filled per call.
  assert.doesNotMatch(knowledge, /£\s?\d|\d+p\b/);
  // Only call answers: a chip that uses a member's own value is not in it.
  assert.doesNotMatch(knowledge, /\[credits\]/);
  const k = agentKnowledge(live, schemaSnapshot());
  assert.deepEqual(k.missingRequired, []);
  assert.ok(!k.slugs.includes('nightly_rate'), 'chat-only entries stay out');
});

test("every variable the agent's prompt uses is one every call sends", () => {
  const sent = new Set(VARIABLE_NAMES);
  for (const v of promptVariables(agentPrompt(knowledge))) assert.ok(sent.has(v) || v.startsWith('system__') || v.startsWith('secret__'), v);
  for (const k of KNOWLEDGE_VARIABLES) assert.ok(sent.has(k), k);
});

test('a required answer missing from the live set blocks a sync', () => {
  const k = agentKnowledge(live.filter((e) => e.slug !== 'calls_how'), schemaSnapshot());
  assert.deepEqual(k.missingRequired, ['calls_how']);
});

test("an answer whose figure doesn't resolve now is left out of the agent's knowledge", () => {
  const k = agentKnowledge(live, schemaSnapshot({ drop: ['si_text_pence'] }));
  assert.ok(!k.slugs.includes('calls_how'));
  assert.ok(k.skipped.some((s) => s.slug === 'calls_how'));
});

test('every tool takes its ids from injected variables and its secret from a secret variable', () => {
  for (const n of TOOL_NAMES) {
    const t = toolConfig(n, 'https://stayful.co.uk') as { api_schema: { url: string; request_headers: Record<string, { variable_name: string }>; request_body_schema: { properties: Record<string, { dynamic_variable?: string }> } } };
    assert.equal(t.api_schema.url, `https://stayful.co.uk/api/voice/tools/${n}`);
    // ElevenLabs' header locator for a dynamic variable is { variable_name } (a { type, dynamic_variable } object is refused with a 422).
    assert.deepEqual(t.api_schema.request_headers['x-si-tool-token'], { variable_name: 'secret__tool_token' });
    assert.equal(t.api_schema.request_body_schema.properties.conversation_id.dynamic_variable, 'system__conversation_id');
  }
  // The text tool takes a template name only — never a number or free text.
  const s = toolConfig('send_template_text', 'https://x') as { api_schema: { request_body_schema: { properties: Record<string, { enum?: string[] }> } } };
  const props = Object.keys(s.api_schema.request_body_schema.properties).filter((k) => !['conversation_id', 'call_sid', 'caller_id', 'called_number'].includes(k));
  assert.deepEqual(props, ['template']);
  assert.deepEqual(s.api_schema.request_body_schema.properties.template.enum, ['contact_card', 'auto_topup_link', 'resend_last_link']);
});

test('the agent uses the one voice, ends voicemail without a message, and keeps transcripts 90 days', () => {
  const a = agentConfig({ knowledge, voiceId: 'v1', toolIds: ['t1'], maxCallSeconds: 600, retentionDays: 90 }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(a.conversation_config.tts.voice_id, 'v1');
  assert.equal(a.conversation_config.conversation.max_duration_seconds, 600);
  assert.equal(a.conversation_config.agent.prompt.built_in_tools.voicemail_detection.params.voicemail_message, '');
  assert.equal(a.platform_settings.privacy.retention_days, 90);
});

test('call variables carry every name, never a balance; openers are filled', () => {
  const v = callVariables({ callType: 'intro', context: 'intro', firstName: 'Sam', member: true, cardSent: false, minutesAvailable: 6.7, topupAmountPence: 2500, topupThresholdPence: 500 });
  assert.deepEqual(Object.keys(v).sort(), [...VARIABLE_NAMES].sort());
  // A knowledge figure not passed in goes out as the neutral fallback, never missing (a missing variable stops the call).
  assert.equal(v.k_full_analysis_cost, 'shown in the app');
  assert.equal(callVariables({ callType: 'intro', context: 'intro', firstName: 'Sam', member: true, cardSent: false, minutesAvailable: 6, topupAmountPence: 2500, topupThresholdPence: 500, knowledge: { k_full_analysis_cost: '£4' } }).k_full_analysis_cost, '£4');
  assert.equal(v.minutes_available, 6);
  assert.equal(v.topup_amount, '25 pounds');
  assert.ok(!Object.keys(v).some((k) => /balance|address|price/.test(k)));
  assert.equal(fill(openerFor('member'), v), 'Hi Sam, how can I help?');
  assert.match(fill(openerFor('unknown'), callVariables({ callType: 'callback', context: 'unknown', firstName: null, member: false, cardSent: false, minutesAvailable: 10, topupAmountPence: 2500, topupThresholdPence: 500 })), /Stayful Intelligence/);
});

test('remember_fact needs the fact, the question asked and an explicit yes', () => {
  const t = toolConfig('remember_fact', 'https://x') as { api_schema: { request_body_schema: { properties: Record<string, { type: string }>; required: string[] } } };
  assert.deepEqual([...t.api_schema.request_body_schema.required].filter((k) => k !== 'conversation_id').sort(), ['asked', 'fact', 'member_said_yes']);
  assert.equal(t.api_schema.request_body_schema.properties.member_said_yes.type, 'boolean');
  assert.match(agentPrompt(knowledge), /Want me to remember that\?/);
});

test('every tool property has exactly one value source, as ElevenLabs requires', () => {
  const sources = ['description', 'dynamic_variable', 'constant_value', 'is_system_provided'] as const;
  for (const n of TOOL_NAMES) {
    const t = toolConfig(n, 'https://x') as { api_schema: { request_body_schema: { properties: Record<string, Record<string, unknown>> } } };
    for (const [k, p] of Object.entries(t.api_schema.request_body_schema.properties)) {
      const set = sources.filter((f) => p[f] !== undefined && p[f] !== '');
      assert.equal(set.length, 1, `${n}.${k} has ${set.join(', ') || 'no value source'}`);
    }
  }
});

test('the built-in tools say they are system tools', () => {
  const c = agentConfig({ knowledge: '', voiceId: 'v', toolIds: [], maxCallSeconds: 600, retentionDays: 90 }) as { conversation_config: { agent: { prompt: { built_in_tools: Record<string, { type?: string; params: { system_tool_type: string } }> } } } };
  for (const [name, t] of Object.entries(c.conversation_config.agent.prompt.built_in_tools)) {
    assert.equal(t.type, 'system', name);
    assert.equal(t.params.system_tool_type, name);
  }
});

test("the agent's speech model is one ElevenLabs allows for an English agent (turbo or flash v2)", () => {
  const c = agentConfig({ knowledge: '', voiceId: 'v', toolIds: [], maxCallSeconds: 600, retentionDays: 90 }) as { conversation_config: { agent: { language: string }; tts: { model_id: string } } };
  assert.equal(c.conversation_config.agent.language, 'en');
  assert.ok(['eleven_turbo_v2', 'eleven_flash_v2'].includes(c.conversation_config.tts.model_id), c.conversation_config.tts.model_id);
});

test('inbound calls ask our webhook who is ringing, set on this agent only', () => {
  const base = { knowledge: '', voiceId: 'v', toolIds: [], maxCallSeconds: 600, retentionDays: 90 };
  type P = { platform_settings: { overrides: Record<string, unknown>; workspace_overrides?: { conversation_initiation_client_data_webhook?: { url: string; request_headers: Record<string, unknown> }; webhooks?: Record<string, unknown> } } };
  const on = agentConfig({ ...base, initiationWebhook: { url: 'https://x/api/voice/elevenlabs/initiate', secret: 's3cret' }, postCallWebhookId: 'wh1' }) as P;
  assert.equal(on.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, true);
  const hook = on.platform_settings.workspace_overrides!.conversation_initiation_client_data_webhook!;
  assert.equal(hook.url, 'https://x/api/voice/elevenlabs/initiate');
  // A plain string header: the initiate route compares x-si-secret with ELEVENLABS_INITIATE_SECRET.
  assert.equal(INITIATE_SECRET_HEADER, 'x-si-secret');
  assert.deepEqual(hook.request_headers, { 'x-si-secret': 's3cret' });
  assert.deepEqual(on.platform_settings.workspace_overrides!.webhooks, { post_call_webhook_id: 'wh1', events: ['transcript', 'call_initiation_failure', 'answering_machine_detection'] });
  // The opener override the initiate route sends stays allowed.
  assert.deepEqual(on.platform_settings.overrides.conversation_config_override, { agent: { first_message: true } });

  // Nothing to set and nothing there: the fetch stays off and no webhook is sent.
  const off = agentConfig(base) as P;
  assert.equal(off.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, false);
  assert.equal(off.platform_settings.workspace_overrides, undefined);

  // Nothing to set but the agent has them: sent back as they are, never wiped.
  const keep = agentConfig({ ...base, current: { fetchInitiation: true, initiationWebhook: { url: 'https://old', request_headers: {} }, webhooks: { post_call_webhook_id: 'old', events: ['transcript'] } } }) as P;
  assert.equal(keep.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook, true);
  assert.deepEqual(keep.platform_settings.workspace_overrides, { conversation_initiation_client_data_webhook: { url: 'https://old', request_headers: {} }, webhooks: { post_call_webhook_id: 'old', events: ['transcript'] } });
});

test('the post-call events are ElevenLabs event types the webhook route handles', () => {
  const allowed = ['transcript', 'audio', 'call_initiation_failure', 'answering_machine_detection', 'unredacted_transcript', 'unredacted_audio'];
  for (const [setting, type] of Object.entries(POST_CALL_EVENTS)) {
    assert.ok(allowed.includes(setting), setting);
    assert.ok(!/audio/.test(setting), 'no audio');
    const e = parseWebhook({ type, data: { conversation_id: 'c1', answered_by: 'human' } });
    assert.ok(e && e.type === type, `${type} is not handled`);
  }
});

test('the post-call webhook is found by its URL', () => {
  const url = 'https://intelligence.stayful.co.uk/api/voice/elevenlabs/webhook';
  const list = (hooks: Record<string, unknown>[]) => ({ webhooks: hooks });
  assert.deepEqual(pickPostCallWebhook(list([{ webhook_id: 'n8n', webhook_url: 'https://stayful.app.n8n.cloud/webhook/elevenlabs-noshow-postcall' }, { webhook_id: 'ours', webhook_url: `${url}/` }]), url), { id: 'ours', autoDisabled: false });
  // Switched off by hand: skipped. Switched off by ElevenLabs: used only when there is nothing better, and flagged.
  assert.equal(pickPostCallWebhook(list([{ webhook_id: 'off', webhook_url: url, is_disabled: true }]), url), null);
  assert.deepEqual(pickPostCallWebhook(list([{ webhook_id: 'auto', webhook_url: url, is_auto_disabled: true }, { webhook_id: 'ok', webhook_url: url }]), url), { id: 'ok', autoDisabled: false });
  assert.deepEqual(pickPostCallWebhook(list([{ webhook_id: 'auto', webhook_url: url, is_auto_disabled: true }]), url), { id: 'auto', autoDisabled: true });
  assert.equal(pickPostCallWebhook(list([]), url), null);
  assert.equal(pickPostCallWebhook(null, url), null);
});
