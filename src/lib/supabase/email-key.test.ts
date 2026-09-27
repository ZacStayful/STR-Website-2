import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailKey } from './email-key.ts';

test('an email is looked up in its stored form: trimmed and lowercase', () => {
  assert.equal(emailKey('  Jane_Doe@Gmail.com '), 'jane_doe@gmail.com');
});

test('wildcard characters are kept as themselves (the look-up is an equality, never a pattern)', () => {
  assert.equal(emailKey('j*@x.com'), 'j*@x.com');
  assert.equal(emailKey('a%b_c@x.com'), 'a%b_c@x.com');
});
