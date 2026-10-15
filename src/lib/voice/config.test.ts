import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALL_TYPES, CALL_TYPE_LABEL, INTRO_DELAY_MS, OUTBOUND_CALL_TYPES, isOutboundCallType } from './config.ts';

test('the outbound types are every call type but the callback (R3-99, R2-171)', () => {
  assert.deepEqual([...OUTBOUND_CALL_TYPES], CALL_TYPES.filter((t) => t !== 'callback'));
  assert.deepEqual([...OUTBOUND_CALL_TYPES], ['intro', 'low_credit', 'deal']);
  assert.equal(isOutboundCallType('deal'), true);
  assert.equal(isOutboundCallType('callback'), false);
  assert.equal(isOutboundCallType('nonsense'), false);
  for (const t of CALL_TYPES) assert.ok(CALL_TYPE_LABEL[t].length > 0, t);
});

test('the intro waits a few minutes for the sign-up to finish (R3-23)', () => {
  assert.ok(INTRO_DELAY_MS >= 2 * 60_000 && INTRO_DELAY_MS <= 15 * 60_000);
});
