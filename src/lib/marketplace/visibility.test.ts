import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealVisibility, dealVisible, PAID_VISIBILITY } from './visibility.ts';

const NOW = new Date('2026-09-25T14:37:00Z');

test('a paying account has no cutoff', () => {
  assert.deepEqual(dealVisibility('paid', NOW, 48), { tier: 'paid', cutoffIso: null, hourCutoffIso: null });
  assert.equal(dealVisible(null, PAID_VISIBILITY.cutoffIso), true);
});

test('a free account sees deals that went live 48 hours ago, exact and hour-floored', () => {
  const v = dealVisibility('free', NOW, 48);
  assert.equal(v.cutoffIso, '2026-09-23T14:37:00.000Z');
  assert.equal(v.hourCutoffIso, '2026-09-23T14:00:00.000Z');
});

test('the boundary is inclusive: live exactly at the cutoff is visible, a second later is not', () => {
  const v = dealVisibility('free', NOW, 48);
  assert.equal(dealVisible('2026-09-23T14:37:00.000Z', v.cutoffIso), true);
  assert.equal(dealVisible('2026-09-23T14:37:01.000Z', v.cutoffIso), false);
  assert.equal(dealVisible('2026-09-20T00:00:00.000Z', v.cutoffIso), true);
});

test('a live row the trigger has not stamped is hidden from the delayed tier, never shown early', () => {
  const v = dealVisibility('free', NOW, 48);
  assert.equal(dealVisible(null, v.cutoffIso), false);
  assert.equal(dealVisible(undefined, v.cutoffIso), false);
  assert.equal(dealVisible('not a date', v.cutoffIso), false);
});

test('a delay of zero (or junk) switches the window off for everyone', () => {
  assert.equal(dealVisibility('free', NOW, 0).cutoffIso, null);
  assert.equal(dealVisibility('free', NOW, Number.NaN).cutoffIso, null);
  assert.equal(dealVisible(null, dealVisibility('free', NOW, 0).cutoffIso), true);
});

test('the setting is read in hours, so 1 hour hides only the last hour', () => {
  const v = dealVisibility('free', NOW, 1);
  assert.equal(v.cutoffIso, '2026-09-25T13:37:00.000Z');
  assert.equal(dealVisible('2026-09-25T13:00:00.000Z', v.cutoffIso), true);
  assert.equal(dealVisible('2026-09-25T14:00:00.000Z', v.cutoffIso), false);
});
