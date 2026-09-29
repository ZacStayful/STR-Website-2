import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSignal } from './rank-signal.ts';

const POINTS = { high: 5, medium: 3, low: 0 };

test('a checked deal is lifted by its confidence, with the count in the reason and nothing else', () => {
  assert.deepEqual(checkSignal('high', 12, POINTS), { points: 5, reason: 'checked on 12 similar Airbnbs nearby' });
  assert.deepEqual(checkSignal('medium', '8', POINTS), { points: 3, reason: 'checked on 8 similar Airbnbs nearby' });
  assert.deepEqual(checkSignal('high', 1, POINTS), { points: 5, reason: 'checked on 1 similar Airbnb nearby' });
});

test('no check, or a low-confidence one, is no signal', () => {
  assert.equal(checkSignal('high', null, POINTS), null, 'an area estimate at high confidence is still not a check');
  assert.equal(checkSignal('high', 0, POINTS), null);
  assert.equal(checkSignal('low', 12, POINTS), null);
  assert.equal(checkSignal(null, 12, POINTS), null);
  assert.equal(checkSignal('high', 12, { high: 0, medium: 0, low: 0 }), null, 'switched off in the settings');
});
