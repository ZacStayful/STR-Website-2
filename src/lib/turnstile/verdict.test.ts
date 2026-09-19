import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSiteverify, missingToken, notConfigured, unreachable,
  turnstileConfigured, parseErrorCodes,
} from './verdict.ts';

test('a success is allowed', () => {
  assert.deepEqual(readSiteverify({ success: true }), { allow: true, reason: 'passed' });
});

test('only a literal true is a pass', () => {
  // A truthy-but-not-true value must never read as success — that is how a
  // malformed response becomes an open door.
  for (const value of ['true', 1, {}, [], 'yes']) {
    const out = readSiteverify({ success: value });
    assert.equal(out.allow, false, `${JSON.stringify(value)} should not pass`);
  }
});

test('a plain failure is refused', () => {
  const out = readSiteverify({ success: false, 'error-codes': ['invalid-input-secret'] });
  assert.equal(out.allow, false);
  assert.equal(out.reason, 'failed');
  assert.deepEqual(out.allow === false ? out.codes : [], ['invalid-input-secret']);
});

test('an expired or reused token gets the friendlier wording', () => {
  // Overwhelmingly this is a real person who took a while over the form, not
  // a bot. Telling them to try again is the right response.
  for (const code of ['timeout-or-duplicate', 'invalid-input-response']) {
    const out = readSiteverify({ success: false, 'error-codes': [code] });
    assert.equal(out.allow, false);
    assert.match(out.allow === false ? out.message : '', /expired.*try again/i);
  }
});

test('a configuration problem gets the refresh wording, not "expired"', () => {
  const out = readSiteverify({ success: false, 'error-codes': ['invalid-input-secret'] });
  assert.match(out.allow === false ? out.message : '', /refresh/i);
});

test('no message ever accuses the person of being a bot', () => {
  // They are almost always a real prospect, and a customer is paying for
  // this page to collect them.
  const messages = [
    readSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    readSiteverify({ success: false }),
    missingToken(),
  ];
  for (const m of messages) {
    const text = m.allow === false ? m.message.toLowerCase() : '';
    for (const word of ['bot', 'robot', 'automated', 'suspicious']) {
      assert.ok(!text.includes(word), `message should not say "${word}": ${text}`);
    }
  }
});

test('a missing or malformed body is refused, not crashed on', () => {
  for (const body of [null, undefined, {}]) {
    assert.equal(readSiteverify(body).allow, false);
  }
});

test('error codes are read defensively', () => {
  assert.deepEqual(parseErrorCodes(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseErrorCodes(['a', 2, null, '']), ['a']);
  assert.deepEqual(parseErrorCodes('not an array'), []);
  assert.deepEqual(parseErrorCodes(undefined), []);
});

test('an unreachable Cloudflare fails OPEN', () => {
  // An outage must not stop a customer collecting leads. The atomic caps and
  // the spend ceiling still apply, so this drops back to exactly the
  // protection the funnel had before Turnstile existed.
  assert.deepEqual(unreachable(), { allow: true, reason: 'unreachable' });
});

test('an unconfigured deployment is a no-op, not a wall', () => {
  // Existing funnels must keep working before the keys are set.
  assert.deepEqual(notConfigured(), { allow: true, reason: 'not_configured' });
});

test('a missing token is refused', () => {
  const out = missingToken();
  assert.equal(out.allow, false);
  assert.equal(out.reason, 'missing_token');
});

test('both halves of the key pair are needed', () => {
  assert.equal(turnstileConfigured('secret', 'site'), true);
  assert.equal(turnstileConfigured('secret', undefined), false);
  assert.equal(turnstileConfigured(undefined, 'site'), false);
  assert.equal(turnstileConfigured('', 'site'), false);
  assert.equal(turnstileConfigured('  ', 'site'), false);
  assert.equal(turnstileConfigured(undefined, undefined), false);
});
