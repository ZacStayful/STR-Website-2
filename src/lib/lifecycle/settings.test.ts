import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIFECYCLE, LIFECYCLE_KEYS, isPackAccount, parseLifecycle, starterPackBonusPence } from './settings.ts';

const from = (rows: Record<string, unknown>) => parseLifecycle((k) => rows[k]);

test('the defaults are the brief: £10 for £30, 7 days, £5, 14 and 25 days, both dates off', () => {
  assert.deepEqual(from({}), DEFAULT_LIFECYCLE);
  assert.equal(DEFAULT_LIFECYCLE.starterPackPricePence, 1000);
  assert.equal(DEFAULT_LIFECYCLE.starterPackCreditPence, 3000);
  assert.equal(DEFAULT_LIFECYCLE.starterPackSnoozeDays, 7);
  assert.equal(DEFAULT_LIFECYCLE.lowCreditPence, 500);
  assert.equal(DEFAULT_LIFECYCLE.inactiveReengageDays, 14);
  assert.equal(DEFAULT_LIFECYCLE.picksPauseInactiveDays, 25);
  assert.equal(DEFAULT_LIFECYCLE.starterPackFrom, null);
  assert.equal(DEFAULT_LIFECYCLE.inactivityFrom, null);
});

test('stored values are read, numbers as JSON numbers or strings', () => {
  const s = from({
    [LIFECYCLE_KEYS.starterPackFrom]: '2026-10-01T09:00:00Z',
    [LIFECYCLE_KEYS.starterPackPricePence]: 1500,
    [LIFECYCLE_KEYS.starterPackCreditPence]: '4000',
    [LIFECYCLE_KEYS.starterPackSnoozeDays]: 3,
    [LIFECYCLE_KEYS.lowCreditPence]: 0,
    [LIFECYCLE_KEYS.inactiveReengageDays]: 10,
    [LIFECYCLE_KEYS.picksPauseInactiveDays]: 30,
    [LIFECYCLE_KEYS.inactivityFrom]: '2026-10-02',
  });
  assert.equal(s.starterPackFrom, '2026-10-01T09:00:00.000Z');
  assert.equal(s.starterPackPricePence, 1500);
  assert.equal(s.starterPackCreditPence, 4000);
  assert.equal(s.starterPackSnoozeDays, 3);
  assert.equal(s.lowCreditPence, 0);
  assert.equal(s.inactiveReengageDays, 10);
  assert.equal(s.picksPauseInactiveDays, 30);
  assert.equal(s.inactivityFrom, '2026-10-02T00:00:00.000Z');
});

test('malformed values fall back to their defaults', () => {
  const s = from({
    [LIFECYCLE_KEYS.starterPackFrom]: 'soon',
    [LIFECYCLE_KEYS.starterPackPricePence]: -5,
    [LIFECYCLE_KEYS.starterPackCreditPence]: 'lots',
    [LIFECYCLE_KEYS.starterPackSnoozeDays]: 0,
    [LIFECYCLE_KEYS.lowCreditPence]: 2.5,
    [LIFECYCLE_KEYS.inactiveReengageDays]: null,
    [LIFECYCLE_KEYS.picksPauseInactiveDays]: '',
    [LIFECYCLE_KEYS.inactivityFrom]: '',
  });
  assert.deepEqual(s, DEFAULT_LIFECYCLE);
});

test('the pack never gives less credit than it costs, so the bonus is never negative', () => {
  const s = from({ [LIFECYCLE_KEYS.starterPackPricePence]: 2000, [LIFECYCLE_KEYS.starterPackCreditPence]: 1500 });
  assert.equal(s.starterPackCreditPence, 2000);
  assert.equal(starterPackBonusPence(s), 0);
  assert.equal(starterPackBonusPence(DEFAULT_LIFECYCLE), 2000);
});

test('a pack account is one created at or after the cutover, and only when a cutover is set', () => {
  const s = { starterPackFrom: '2026-10-01T09:00:00.000Z' };
  assert.equal(isPackAccount('2026-10-01T09:00:00.000Z', s), true);
  assert.equal(isPackAccount('2026-10-05T12:00:00Z', s), true);
  assert.equal(isPackAccount('2026-10-01T08:59:59Z', s), false);
  assert.equal(isPackAccount('2026-10-05T12:00:00Z', { starterPackFrom: null }), false);
  assert.equal(isPackAccount(null, s), false);
  assert.equal(isPackAccount('not a date', s), false);
});
