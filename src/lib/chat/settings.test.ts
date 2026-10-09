import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHAT_SETTING_KEYS, DEFAULT_CHAT_SETTINGS, parseChatSettings, validateChatForm } from './settings.ts';

const form = (o: Record<string, string>) => (name: string) => (name in o ? o[name] : null);

test('missing or bad rows take the defaults', () => {
  assert.deepEqual(parseChatSettings(new Map()), DEFAULT_CHAT_SETTINGS);
  const s = parseChatSettings(new Map<string, unknown>([['si_chat_full_max_tool_rounds', 2.5], ['si_chat_markup', 0], ['si_chat_full_ceiling_pence', '30']]));
  assert.equal(s.fullMaxToolRounds, 4);
  assert.equal(s.markup, 5);
  assert.equal(s.fullCeilingPence, 30);
});

test('only an explicit false switches the chat off', () => {
  assert.equal(parseChatSettings(new Map([['si_chat_enabled', false]])).enabled, false);
  assert.equal(parseChatSettings(new Map([['si_chat_enabled', 'false']])).enabled, false);
  assert.equal(parseChatSettings(new Map([['si_chat_enabled', 'maybe']])).enabled, true);
});

test('a floor above its ceiling takes the ceiling', () => {
  const s = parseChatSettings(new Map([['si_chat_quick_ceiling_pence', 1], ['si_chat_quick_floor_pence', 5]]));
  assert.equal(s.quickFloorPence, 1);
});

test('the seconds between questions can never be 0', () => {
  assert.equal(parseChatSettings(new Map([['si_chat_min_seconds', 0]])).minSeconds, 3);
});

test('the admin form needs every number in bounds and floors under ceilings', () => {
  const all: Record<string, string> = { enabled: 'on', voice: 'on' };
  for (const [k, v] of Object.entries(DEFAULT_CHAT_SETTINGS)) if (k !== 'enabled' && k !== 'voice') all[k] = String(v);
  assert.deepEqual(validateChatForm(form(all)), { ok: true, settings: DEFAULT_CHAT_SETTINGS });
  assert.equal(validateChatForm(form({ ...all, fullCeilingPence: '0' })).ok, false);
  assert.equal(validateChatForm(form({ ...all, fullFloorPence: '30' })).ok, false);
  const off = validateChatForm(form({ ...all, enabled: '' }));
  assert.equal(off.ok && off.settings.enabled, false);
});

test('every setting is seeded in supabase/schema.sql with its default', () => {
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  for (const [field, key] of Object.entries(CHAT_SETTING_KEYS)) {
    const m = sql.match(new RegExp(`\\('${key}',\\s*'([^']*)'::jsonb\\)`));
    assert.ok(m, `${key} is not seeded`);
    const want = DEFAULT_CHAT_SETTINGS[field as keyof typeof DEFAULT_CHAT_SETTINGS];
    assert.equal(typeof want === 'boolean' ? m[1] === 'true' : Number(m[1]), want, key);
  }
});

test('the schema lets the conversation log take a chat question (R2-87)', () => {
  const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /si_conversation_questions_source_check check \(source in \('tool', 'analysis', 'sms', 'chat'\)\)/);
});

test('voice is on unless its row says off, and the form switch sets it', () => {
  assert.equal(parseChatSettings(new Map()).voice, true);
  assert.equal(parseChatSettings(new Map([['si_chat_voice_enabled', false]])).voice, false);
  assert.equal(parseChatSettings(new Map([['si_chat_voice_enabled', 'maybe']])).voice, true);
  const all: Record<string, string> = { enabled: 'on', voice: '' };
  for (const [k, v] of Object.entries(DEFAULT_CHAT_SETTINGS)) if (k !== 'enabled' && k !== 'voice') all[k] = String(v);
  const r = validateChatForm((n) => all[n] ?? null);
  assert.equal(r.ok && r.settings.voice, false);
});
