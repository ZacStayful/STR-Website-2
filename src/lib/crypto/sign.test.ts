import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWith, verifyWith, expiringPayload, verifyExpiring } from './sign.ts';

const KEY = 'a-test-signing-key-that-is-long-enough';

test('a signature verifies under the key that made it and no other', () => {
  const sig = signWith(KEY, 'deal-1:1900000000');
  assert.equal(sig.length, 22);
  assert.ok(verifyWith(KEY, 'deal-1:1900000000', sig));
  assert.ok(!verifyWith('another-key-that-is-also-long', 'deal-1:1900000000', sig));
  assert.ok(!verifyWith(KEY, 'deal-2:1900000000', sig));
  assert.ok(!verifyWith(KEY, 'deal-1:1900000000', sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')));
  assert.ok(!verifyWith(KEY, 'deal-1:1900000000', null));
  assert.ok(!verifyWith(KEY, 'deal-1:1900000000', ''));
});

test('an expiring payload stops verifying once its time has passed', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  const exp = Math.floor(now.getTime() / 1000) + 3600;
  const sig = signWith(KEY, expiringPayload('deal-1', exp));
  assert.ok(verifyExpiring(KEY, 'deal-1', exp, sig, now));
  assert.ok(verifyExpiring(KEY, 'deal-1', String(exp), sig, now), 'exp arrives as a query string');
  assert.ok(!verifyExpiring(KEY, 'deal-1', exp, sig, new Date(now.getTime() + 3601 * 1000)), 'expired');
  assert.ok(!verifyExpiring(KEY, 'deal-1', exp + 1, sig, now), 'exp tampered');
  assert.ok(!verifyExpiring(KEY, 'deal-1', 'soon', sig, now), 'malformed exp');
  assert.ok(!verifyExpiring(KEY, 'deal-1', null, sig, now));
});
