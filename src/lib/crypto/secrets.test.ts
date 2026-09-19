import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  parseKey, generateKey, encryptWith, decryptWith, secretsEqual, SecretKeyError,
} from './secrets.ts';

const key = randomBytes(32);
const other = randomBytes(32);

test('a secret survives a round trip', () => {
  const secret = 'eyJhbGciOiJIUzI1NiJ9.monday-api-key.signature';
  assert.equal(decryptWith(key, encryptWith(key, secret)), secret);
});

test('the same plaintext encrypts differently every time', () => {
  // A fresh IV per encryption, so two customers with the same key do not
  // produce matching ciphertext and give each other away.
  const a = encryptWith(key, 'same');
  const b = encryptWith(key, 'same');
  assert.notEqual(a, b);
  assert.equal(decryptWith(key, a), 'same');
  assert.equal(decryptWith(key, b), 'same');
});

test('the wrong key returns null rather than garbage', () => {
  assert.equal(decryptWith(other, encryptWith(key, 'secret')), null);
});

test('tampering is detected, not decrypted', () => {
  const stored = encryptWith(key, 'secret');
  const [iv, tag, ct] = stored.split(':');
  // Flip a byte of the ciphertext; GCM's tag must reject it.
  const bytes = Buffer.from(ct, 'base64url');
  bytes[0] ^= 0xff;
  assert.equal(decryptWith(key, [iv, tag, bytes.toString('base64url')].join(':')), null);
  // And a swapped tag.
  assert.equal(decryptWith(key, [iv, Buffer.from(tag, 'base64url').reverse().toString('base64url'), ct].join(':')), null);
});

test('malformed stored values return null instead of throwing', () => {
  for (const bad of ['', 'nope', 'a:b', 'a:b:c:d', ':::', 'a:b:c']) {
    assert.equal(decryptWith(key, bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('a key of the wrong length is refused, never padded', () => {
  assert.equal(parseKey(randomBytes(16).toString('base64')), null);
  assert.equal(parseKey(randomBytes(64).toString('hex')), null);
  assert.equal(parseKey(''), null);
  assert.equal(parseKey(undefined), null);
  assert.throws(() => encryptWith(randomBytes(16), 'x'), SecretKeyError);
});

test('a generated key parses, in base64 or hex', () => {
  assert.equal(parseKey(generateKey())?.length, 32);
  assert.equal(parseKey(randomBytes(32).toString('hex'))?.length, 32);
  // Whitespace from a copied env value is tolerated.
  assert.equal(parseKey(`  ${generateKey()}  `)?.length, 32);
});

test('an empty plaintext round-trips rather than looking like a failure', () => {
  assert.equal(decryptWith(key, encryptWith(key, '')), '');
});

test('unicode survives the round trip', () => {
  const s = 'clé-secrète-🔑';
  assert.equal(decryptWith(key, encryptWith(key, s)), s);
});

test('signature compare is length-safe', () => {
  assert.equal(secretsEqual('abc', 'abc'), true);
  assert.equal(secretsEqual('abc', 'abd'), false);
  assert.equal(secretsEqual('abc', 'abcd'), false);
  assert.equal(secretsEqual('', ''), true);
});
