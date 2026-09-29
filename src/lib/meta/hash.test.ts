import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashEmail, hashExternalId, normaliseEmail, sha256Hex } from './hash.ts';

test("Meta's documented example hashes the same", () => {
  // developers.facebook.com → Customer information parameters → em
  assert.equal(hashEmail('john_smith@gmail.com'), '62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f');
});

test('emails are trimmed and lower-cased before hashing', () => {
  assert.equal(hashEmail('  John_Smith@Gmail.com '), hashEmail('john_smith@gmail.com'));
  assert.equal(normaliseEmail(' A@B.CO '), 'a@b.co');
});

test('something that is not an email is never hashed', () => {
  assert.equal(hashEmail('not an email'), null);
  assert.equal(hashEmail(''), null);
  assert.equal(hashEmail(null), null);
});

test('the user id is hashed lower-cased, so browser and server agree', () => {
  const id = '8F14E45F-CEEA-467A-9C3B-1A2B3C4D5E6F';
  assert.equal(hashExternalId(id), sha256Hex(id.toLowerCase()));
  assert.equal(hashExternalId(id)?.length, 64);
  assert.equal(hashExternalId(''), null);
});
