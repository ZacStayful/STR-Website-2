import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEMAND_SETTINGS, DEMAND_SETTING_KEYS, parseDemandSettings, poundsToPence, validateSettingsForm } from './settings.ts';

test('no rows at all: every default, as decided (2 members, £100 a month)', () => {
  const s = parseDemandSettings(new Map());
  assert.deepEqual(s, DEFAULT_DEMAND_SETTINGS);
  assert.equal(s.minMembers, 2);
  assert.equal(s.capPence, 10_000);
});

test('stored rows are read, numbers or numeric strings', () => {
  const s = parseDemandSettings(
    new Map<string, unknown>([
      [DEMAND_SETTING_KEYS.minMembers, 3],
      [DEMAND_SETTING_KEYS.capPence, '2500'],
      [DEMAND_SETTING_KEYS.payingWeight, 1.5],
      [DEMAND_SETTING_KEYS.radiusAreas, 0],
      [DEMAND_SETTING_KEYS.activeDays, 14],
      [DEMAND_SETTING_KEYS.maxAreasPerProfile, 4],
    ]),
  );
  assert.deepEqual(s, { minMembers: 3, capPence: 2500, payingWeight: 1.5, radiusAreas: 0, activeDays: 14, maxAreasPerProfile: 4 });
});

test('a £0 cap is allowed (it stops every demand-led search)', () => {
  assert.equal(parseDemandSettings(new Map([[DEMAND_SETTING_KEYS.capPence, 0]])).capPence, 0);
});

test('junk or out-of-bounds rows fall back to the default, never to something looser', () => {
  const s = parseDemandSettings(
    new Map<string, unknown>([
      [DEMAND_SETTING_KEYS.minMembers, 0],
      [DEMAND_SETTING_KEYS.capPence, 99_999_999],
      [DEMAND_SETTING_KEYS.payingWeight, 'lots'],
      [DEMAND_SETTING_KEYS.radiusAreas, 2.5],
      [DEMAND_SETTING_KEYS.activeDays, null],
      [DEMAND_SETTING_KEYS.maxAreasPerProfile, { n: 3 }],
    ]),
  );
  assert.deepEqual(s, DEFAULT_DEMAND_SETTINGS);
});

test('poundsToPence reads what an admin types', () => {
  assert.equal(poundsToPence('100'), 10_000);
  assert.equal(poundsToPence('£1,000'), 100_000);
  assert.equal(poundsToPence(' 12.5 '), 1250);
  assert.equal(poundsToPence('0.01'), 1);
  assert.equal(poundsToPence('12.345'), null);
  assert.equal(poundsToPence('-5'), null);
  assert.equal(poundsToPence(''), null);
  assert.equal(poundsToPence(null), null);
});

const form = (over: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = { minMembers: '2', capPounds: '100', payingWeight: '2', radiusAreas: '5', activeDays: '30', maxAreasPerProfile: '10', ...over };
  return (name: string) => base[name] ?? null;
};

test('the settings form: a complete, valid form becomes settings', () => {
  const r = validateSettingsForm(form({ capPounds: '£250' }));
  assert.deepEqual(r, { ok: true, settings: { ...DEFAULT_DEMAND_SETTINGS, capPence: 25_000 } });
});

test('the settings form refuses anything missing or out of bounds, with a reason', () => {
  const bad: Record<string, string | null>[] = [
    { minMembers: '0' },
    { minMembers: '2.5' },
    { capPounds: '' },
    { capPounds: 'a lot' },
    { capPounds: '20000' },
    { payingWeight: '0.5' },
    { radiusAreas: null },
    { activeDays: '400' },
    { maxAreasPerProfile: '0' },
  ];
  for (const over of bad) {
    const r = validateSettingsForm(form(over));
    assert.equal(r.ok, false, JSON.stringify(over));
    if (!r.ok) assert.ok(r.error.length > 10);
  }
});

test('the settings form accepts a £0 cap and no radius areas', () => {
  const r = validateSettingsForm(form({ capPounds: '0', radiusAreas: '0' }));
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.settings.capPence, 0);
    assert.equal(r.settings.radiusAreas, 0);
  }
});
