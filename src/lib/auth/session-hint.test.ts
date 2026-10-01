import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSessionCookie } from './session-hint.ts';

test('a Supabase session cookie, plain or chunked, reads as signed in', () => {
  assert.equal(hasSessionCookie('sb-abcdefghijkl-auth-token=base64-xyz'), true);
  assert.equal(hasSessionCookie('sf_consent=accept; sb-abcdefghijkl-auth-token.0=part; sb-abcdefghijkl-auth-token.1=part'), true);
  assert.equal(hasSessionCookie('other=1;sb-proj-ref-auth-token=x'), true);
});

test('anything else does not', () => {
  assert.equal(hasSessionCookie(''), false);
  assert.equal(hasSessionCookie(null), false);
  assert.equal(hasSessionCookie('sf_consent=accept; sf_ref=abc'), false);
  assert.equal(hasSessionCookie('sb-abcdefghijkl-auth-token-code-verifier=pkce'), false);
  assert.equal(hasSessionCookie('notsb-abc-auth-token=x'), false);
});
