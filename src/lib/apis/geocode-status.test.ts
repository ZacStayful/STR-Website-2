import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPostcodeFault } from './geocode-status.ts';

test('nothing found for the postcode is the member’s to fix', () => {
  assert.equal(isPostcodeFault('ZERO_RESULTS'), true);
  assert.equal(isPostcodeFault('INVALID_REQUEST'), true);
  assert.equal(isPostcodeFault('OK', 0), true);
});

test('a key, quota or outage problem is ours, not the postcode', () => {
  for (const status of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'UNKNOWN_ERROR', 'UNKNOWN']) assert.equal(isPostcodeFault(status), false, status);
  assert.equal(isPostcodeFault(null), false);
  assert.equal(isPostcodeFault(''), false);
  assert.equal(isPostcodeFault('OK', 3), false);
});
