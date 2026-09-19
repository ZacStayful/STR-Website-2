import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEnhancedFailure, enhancedNotice, noticeForFailure, noticeForEmptyResult,
} from './enhanced-notice.ts';

// Mirrors PmiError's shape. Written out rather than using a parameter
// property, which node's type-stripping test runner cannot parse.
class FakePmiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

test('a 429 is recognised from the status', () => {
  assert.equal(classifyEnhancedFailure(new FakePmiError('PMI /valuations/str-estimate → HTTP 429', 429)), 'rate_limited');
});

test('a 429 is still recognised when only the message carries it', () => {
  // A failure can surface as a plain Error from a wrapper, and defaulting a
  // real rate limit to the vaguer wording would lose the one piece of advice
  // worth giving: try again in a minute.
  assert.equal(classifyEnhancedFailure(new Error('upstream said 429')), 'rate_limited');
  assert.equal(classifyEnhancedFailure(new Error('Rate limit exceeded')), 'rate_limited');
});

test('anything else is "unavailable" rather than guessed at', () => {
  assert.equal(classifyEnhancedFailure(new FakePmiError('HTTP 500', 500)), 'unavailable');
  assert.equal(classifyEnhancedFailure(new Error('socket hang up')), 'unavailable');
  assert.equal(classifyEnhancedFailure(null), 'unavailable');
  assert.equal(classifyEnhancedFailure(undefined), 'unavailable');
  assert.equal(classifyEnhancedFailure('nonsense'), 'unavailable');
});

test('a 404 is not mistaken for a rate limit', () => {
  // Guards the message check against matching a stray "429" anywhere.
  assert.equal(classifyEnhancedFailure(new FakePmiError('HTTP 404', 404)), 'unavailable');
});

test('every notice tells the customer they were not charged for it', () => {
  // The whole point: they chose to pay more, so silence is what is
  // unacceptable — and the charge being fair is the first thing they will ask.
  for (const reason of ['rate_limited', 'unavailable'] as const) {
    const n = enhancedNotice(reason);
    assert.equal(n.reason, reason);
    assert.match(n.message, /not been charged/);
    assert.ok(n.headline.length > 0);
    assert.ok(n.message.length > 40, 'a one-word notice explains nothing');
  }
});

test('the rate-limited wording says why, the generic one does not pretend to', () => {
  assert.match(enhancedNotice('rate_limited').message, /rate limiting/);
  assert.doesNotMatch(enhancedNotice('unavailable').message, /rate limiting/);
});

test('a caught error goes straight to a notice', () => {
  const n = noticeForFailure(new FakePmiError('HTTP 429', 429));
  assert.equal(n.reason, 'rate_limited');
  assert.equal(n.message, enhancedNotice('rate_limited').message);
});

test('an empty result gets a notice without inventing an error', () => {
  assert.equal(noticeForEmptyResult().reason, 'unavailable');
});

test('a notice survives JSON — it is stored on the report and sent over the API', () => {
  const n = noticeForFailure(new Error('429'));
  assert.deepEqual(JSON.parse(JSON.stringify(n)), n);
});
