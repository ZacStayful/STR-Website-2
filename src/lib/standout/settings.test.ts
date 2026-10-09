import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STANDOUT, parseStandout, STANDOUT_KEYS } from './settings.ts';

const from = (rows: Record<string, unknown>) => (key: string) => rows[key];

test('no rows: every default', () => {
  assert.deepEqual(parseStandout(from({})), DEFAULT_STANDOUT);
});

test('the defaults are the decided numbers', () => {
  assert.equal(DEFAULT_STANDOUT.minMatchPct, 90);
  assert.equal(DEFAULT_STANDOUT.minChecked, 5);
  assert.equal(DEFAULT_STANDOUT.profitOverMinPct, 25);
  assert.equal(DEFAULT_STANDOUT.liveConfirmHours, 6);
  assert.equal(DEFAULT_STANDOUT.callsPerMonth, 2);
  assert.equal(DEFAULT_STANDOUT.callMinBalancePence, 100);
  assert.equal(DEFAULT_STANDOUT.slowerSpenderMinDays, 8);
  assert.equal(DEFAULT_STANDOUT.slowerSpenderMaxDays, 21);
});

test('a row is read, as a number or a string', () => {
  const s = parseStandout(from({ [STANDOUT_KEYS.minMatchPct]: 80, [STANDOUT_KEYS.callsPerMonth]: '3', [STANDOUT_KEYS.maxPerDay]: 0, [STANDOUT_KEYS.beatBestDays]: 0 }));
  assert.equal(s.minMatchPct, 80);
  assert.equal(s.callsPerMonth, 3);
  assert.equal(s.maxPerDay, 0);
  assert.equal(s.beatBestDays, 0);
});

test('a bad or out-of-range row takes its default', () => {
  const s = parseStandout(from({ [STANDOUT_KEYS.minMatchPct]: 150, [STANDOUT_KEYS.minChecked]: 2.5, [STANDOUT_KEYS.callsPerMonth]: 'lots', [STANDOUT_KEYS.liveConfirmHours]: 0 }));
  assert.equal(s.minMatchPct, DEFAULT_STANDOUT.minMatchPct);
  assert.equal(s.minChecked, DEFAULT_STANDOUT.minChecked);
  assert.equal(s.callsPerMonth, DEFAULT_STANDOUT.callsPerMonth);
  assert.equal(s.liveConfirmHours, DEFAULT_STANDOUT.liveConfirmHours);
});

test('the nudge window never ends before it starts', () => {
  const s = parseStandout(from({ [STANDOUT_KEYS.slowerSpenderMinDays]: 10, [STANDOUT_KEYS.slowerSpenderMaxDays]: 5 }));
  assert.equal(s.slowerSpenderMinDays, 10);
  assert.equal(s.slowerSpenderMaxDays, 10);
});

test('every key is a standout_ or slower_spender_ row', () => {
  for (const key of Object.values(STANDOUT_KEYS)) assert.match(key, /^(standout|slower_spender)_[a-z_]+$/);
});
