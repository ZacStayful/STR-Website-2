import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_SERVICE_DOWN, authErrorMessage, isAuthServiceFault } from './error-message.ts';

test('the member’s own mistakes keep Supabase’s words', () => {
  for (const message of ['Invalid login credentials', 'User already registered', 'Email not confirmed', 'Password should be at least 6 characters.']) {
    assert.equal(authErrorMessage({ message, status: 400 }), message, message);
    assert.equal(isAuthServiceFault({ message, status: 422 }), false, message);
  }
});

test('an outage reads as ours, whatever Supabase said', () => {
  for (const error of [
    { message: 'fetch failed' },
    { message: 'TypeError: fetch failed', status: null },
    { message: 'Database error saving new user', status: 500 },
    { message: 'Invalid login credentials', status: 502 },
    { message: 'anything', status: 503 },
    { message: 'request timed out' },
    { message: 'An unexpected failure occurred', code: 'unexpected_failure' },
    { message: 'read ECONNRESET' },
  ]) {
    assert.equal(isAuthServiceFault(error), true, error.message);
    assert.equal(authErrorMessage(error), AUTH_SERVICE_DOWN, error.message);
  }
});

test('nothing at all is treated as the service', () => {
  assert.equal(authErrorMessage(null), AUTH_SERVICE_DOWN);
  assert.equal(isAuthServiceFault(undefined), false);
});
