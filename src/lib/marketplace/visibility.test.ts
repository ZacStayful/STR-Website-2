import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealVisibility, dealVisible, dealVisibleTo, PAID_VISIBILITY, visibilityOrFilter } from './visibility.ts';

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

test('Batch 22: a free member sees their own search finds at once; nobody else does', () => {
  const finder = { ...dealVisibility('free', NOW, 48), ownFinds: ['11111111-1111-4111-8111-111111111111'] };
  const other = dealVisibility('free', NOW, 48);
  const fresh = { id: '11111111-1111-4111-8111-111111111111', live_since: '2026-09-25T14:00:00.000Z' };
  assert.equal(dealVisibleTo(fresh, finder), true);
  assert.equal(dealVisibleTo(fresh, other), false);
  assert.equal(dealVisibleTo({ id: 'x', live_since: '2026-09-25T14:00:00.000Z' }, finder), false);
});

test('Batch 22: the own-finds filter only names UUIDs, and is null without finds', () => {
  const v = dealVisibility('free', NOW, 48);
  assert.equal(visibilityOrFilter(v), null);
  assert.equal(visibilityOrFilter(PAID_VISIBILITY), null);
  const f = visibilityOrFilter({ ...v, ownFinds: ['11111111-1111-4111-8111-111111111111', 'x),or(id.not.is.null'] });
  assert.equal(f, `live_since.lte.${v.cutoffIso},id.in.(11111111-1111-4111-8111-111111111111)`);
});
