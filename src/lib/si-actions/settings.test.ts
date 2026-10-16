import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTION_SETTING_KEYS, DEFAULT_ACTION_SETTINGS, parseActionSettings, validateActionForm } from './settings.ts';

const sql = readFileSync(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8');

test('missing or bad rows take the defaults', () => {
  assert.deepEqual(parseActionSettings(new Map()), DEFAULT_ACTION_SETTINGS);
  const s = parseActionSettings(new Map<string, unknown>([['si_action_instruction_cap_pence', '1500'], ['si_action_undo_hours', 0], ['si_action_stop_grace_seconds', 2.5]]));
  assert.equal(s.instructionCapPence, 1500);
  assert.equal(s.undoHours, 24);
  assert.equal(s.stopGraceSeconds, 5);
});

test('the Stop countdown can never be 0: it is what makes Stop possible', () => {
  assert.equal(parseActionSettings(new Map([['si_action_stop_grace_seconds', 0]])).stopGraceSeconds, 5);
});

test('only an explicit false switches actions off', () => {
  assert.equal(parseActionSettings(new Map([['si_action_enabled', false]])).enabled, false);
  assert.equal(parseActionSettings(new Map([['si_action_enabled', 'nope']])).enabled, true);
});

test('the admin form needs every number in bounds', () => {
  const all: Record<string, string> = { enabled: 'on' };
  for (const [k, v] of Object.entries(DEFAULT_ACTION_SETTINGS)) if (k !== 'enabled') all[k] = String(v);
  assert.deepEqual(validateActionForm((n) => all[n] ?? null), { ok: true, settings: DEFAULT_ACTION_SETTINGS });
  assert.equal(validateActionForm((n) => ({ ...all, undoHours: '0' })[n] ?? null).ok, false);
  assert.equal(validateActionForm((n) => ({ ...all, ratePerHour: '100', ratePerDay: '50' })[n] ?? null).ok, false);
});

test('every setting is seeded in supabase/schema.sql with its default', () => {
  for (const [field, key] of Object.entries(ACTION_SETTING_KEYS)) {
    const m = sql.match(new RegExp(`\\('${key}',\\s*'([^']*)'::jsonb\\)`));
    assert.ok(m, `${key} is not seeded`);
    const want = DEFAULT_ACTION_SETTINGS[field as keyof typeof DEFAULT_ACTION_SETTINGS];
    assert.equal(typeof want === 'boolean' ? m[1] === 'true' : Number(m[1]), want, key);
  }
});

test('the low-credit line is Batch 20’s, not a second key (Zac, 11 Oct)', () => {
  assert.equal(Object.values(ACTION_SETTING_KEYS).some((k) => /low/.test(k)), false);
  assert.match(sql, /\('low_credit_pence',/);
});
