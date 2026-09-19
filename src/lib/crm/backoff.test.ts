import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffMinutes, shouldRetry, nextAttemptAt, MAX_ATTEMPTS, MAX_BACKOFF_MINUTES } from './backoff.ts';

test('the first retry is quick and the rest back off', () => {
  assert.equal(backoffMinutes(1), 1);
  assert.equal(backoffMinutes(2), 5);
  assert.equal(backoffMinutes(3), 25);
});

test('the wait is capped, so a long outage still recovers within the hour', () => {
  assert.equal(backoffMinutes(4), MAX_BACKOFF_MINUTES);
  assert.equal(backoffMinutes(50), MAX_BACKOFF_MINUTES);
});

test('a nonsense attempt count does not produce a nonsense wait', () => {
  for (const n of [0, -3, 0.4, Number.NaN]) {
    const m = backoffMinutes(n);
    assert.ok(m >= 1 && m <= MAX_BACKOFF_MINUTES, `${n} gave ${m}`);
  }
});

test('a permanent failure is not retried, however few attempts it has had', () => {
  // A revoked token or a deleted board fails identically for ever; retrying
  // only buries the error the customer needs to read.
  assert.equal(shouldRetry(1, false), false);
  assert.equal(shouldRetry(1, true), true);
  assert.equal(shouldRetry(1, undefined), true, 'an unstated verdict is treated as worth retrying');
});

test('retries stop at the cap', () => {
  assert.equal(shouldRetry(MAX_ATTEMPTS - 1, true), true);
  assert.equal(shouldRetry(MAX_ATTEMPTS, true), false);
  assert.equal(shouldRetry(MAX_ATTEMPTS + 10, true), false);
});

test('a delivery that is done trying gets no next attempt', () => {
  assert.equal(nextAttemptAt(1, false), null);
  assert.equal(nextAttemptAt(MAX_ATTEMPTS, true), null);
});

test('the next attempt is the backoff from now, as an ISO timestamp', () => {
  const now = Date.UTC(2026, 2, 4, 9, 30, 0);
  assert.equal(nextAttemptAt(1, true, now), '2026-03-04T09:31:00.000Z');
  assert.equal(nextAttemptAt(2, true, now), '2026-03-04T09:35:00.000Z');
  assert.equal(nextAttemptAt(3, true, now), '2026-03-04T09:55:00.000Z');
  // Capped, so the fifth attempt waits the ceiling rather than seven hours.
  assert.equal(nextAttemptAt(5, true, now), '2026-03-04T10:30:00.000Z');
});
