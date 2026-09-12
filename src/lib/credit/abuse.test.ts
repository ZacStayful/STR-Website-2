import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDisposableEmail, normaliseMobile } from './abuse.ts';

test('disposable domains, including sub-domains, are flagged', () => {
  assert.equal(isDisposableEmail('a@mailinator.com'), true);
  assert.equal(isDisposableEmail('a@MAIL.YOPMAIL.COM'), true);
  assert.equal(isDisposableEmail('zac@stayful.co.uk'), false);
  assert.equal(isDisposableEmail('nope'), false);
  assert.equal(isDisposableEmail(null), false);
});

test('mobile numbers normalise to one key however they are typed', () => {
  const k = normaliseMobile('07700 900123');
  assert.equal(k, '+447700900123');
  assert.equal(normaliseMobile('+44 (0)7700-900123'), '+447700900123');
  assert.equal(normaliseMobile('00447700900123'), '+447700900123');
  assert.equal(normaliseMobile('447700900123'), '+447700900123');
  assert.equal(normaliseMobile('12'), null);
});
