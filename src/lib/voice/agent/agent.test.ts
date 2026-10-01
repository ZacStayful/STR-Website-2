import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE, CHANNELS } from '../../persona/stayful-intelligence.ts';
import { FAQS, TRUST_FAQS } from '../../faqs-data.ts';
import { agentPrompt } from './prompt.ts';
import { renderKnowledge } from './knowledge.ts';
import { serviceGuide } from './service-guide.ts';
import { toolConfig } from './tools.ts';
import { agentConfig } from './agent-config.ts';
import { TOOL_NAMES } from '../config.ts';
import { callVariables, fill, openerFor, VARIABLE_NAMES } from './variables.ts';

const guide = serviceGuide({ callPencePerMin: 65, textPence: 22, emailPence: 20, topupAmountPence: 2500, topupThresholdPence: 500 });
const knowledge = renderKnowledge(FAQS, TRUST_FAQS, guide);

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

test('the knowledge carries an id per entry and the live prices', () => {
  assert.match(knowledge, /\[guide\.calls\].*65p a minute.*Texts cost 22p and emails 20p/);
  assert.match(knowledge, /\[faq\.1\]/);
  assert.match(knowledge, /\[trust\.1\]/);
});

test('every tool takes its ids from injected variables and its secret from a secret variable', () => {
  for (const n of TOOL_NAMES) {
    const t = toolConfig(n, 'https://stayful.co.uk') as { api_schema: { url: string; request_headers: Record<string, { dynamic_variable: string }>; request_body_schema: { properties: Record<string, { dynamic_variable?: string }> } } };
    assert.equal(t.api_schema.url, `https://stayful.co.uk/api/voice/tools/${n}`);
    assert.equal(t.api_schema.request_headers['x-si-tool-token'].dynamic_variable, 'secret__tool_token');
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
  assert.equal(v.minutes_available, 6);
  assert.equal(v.topup_amount, '25 pounds');
  assert.ok(!Object.keys(v).some((k) => /balance|address|price/.test(k)));
  assert.equal(fill(openerFor('member'), v), 'Hi Sam, how can I help?');
  assert.match(fill(openerFor('unknown'), callVariables({ callType: 'callback', context: 'unknown', firstName: null, member: false, cardSent: false, minutesAvailable: 10, topupAmountPence: 2500, topupThresholdPence: 500 })), /Stayful Intelligence/);
});
