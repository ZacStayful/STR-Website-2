import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signBody, signatureHeader, parseSignatureHeader, signaturesMatch, verifySignature,
  mintWebhookSecret, DEFAULT_TOLERANCE_SECONDS,
} from './signature.ts';

const SECRET = 'whsec_0123456789abcdef';
const BODY = '{"version":1,"event":"lead.created"}';
const NOW = 1_700_000_000;

test('a signature is stable for the same input and changes with any of it', () => {
  const base = signBody(SECRET, BODY, NOW);
  assert.equal(signBody(SECRET, BODY, NOW), base);
  assert.notEqual(signBody('whsec_other', BODY, NOW), base);
  assert.notEqual(signBody(SECRET, BODY + ' ', NOW), base);
  assert.notEqual(signBody(SECRET, BODY, NOW + 1), base);
  assert.match(base, /^[0-9a-f]{64}$/);
});

test('the header is the t=,v1= form integrators already know', () => {
  const header = signatureHeader(SECRET, BODY, NOW);
  assert.equal(header, `t=${NOW},v1=${signBody(SECRET, BODY, NOW)}`);
  const parsed = parseSignatureHeader(header);
  assert.equal(parsed.timestamp, NOW);
  assert.deepEqual(parsed.signatures, [signBody(SECRET, BODY, NOW)]);
});

test('a well-formed delivery verifies', () => {
  const header = signatureHeader(SECRET, BODY, NOW);
  assert.deepEqual(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW }), { ok: true });
});

test('a tampered body is refused even though the timestamp is fresh', () => {
  const header = signatureHeader(SECRET, BODY, NOW);
  const result = verifySignature({
    secret: SECRET,
    body: BODY.replace('lead.created', 'lead.deleted'),
    header,
    nowSeconds: NOW,
  });
  assert.deepEqual(result, { ok: false, reason: 'no_match' });
});

test('the wrong secret is refused', () => {
  const header = signatureHeader('whsec_attacker', BODY, NOW);
  assert.equal(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW }).reason, 'no_match');
});

test('a replay outside the window is refused in both directions', () => {
  const header = signatureHeader(SECRET, BODY, NOW);
  const late = verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW + DEFAULT_TOLERANCE_SECONDS + 1 });
  assert.equal(late.reason, 'timestamp_out_of_range');
  // A clock AHEAD of ours is as suspicious as one behind.
  const early = verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW - DEFAULT_TOLERANCE_SECONDS - 1 });
  assert.equal(early.reason, 'timestamp_out_of_range');
  // The edges themselves are inside.
  assert.equal(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW + DEFAULT_TOLERANCE_SECONDS }).ok, true);
});

test('the timestamp cannot be swapped for a fresh one — it is inside the signed string', () => {
  // The forgery this design exists to stop: take a real delivery, keep its
  // signature, move its timestamp forward to get back inside the window.
  const real = signBody(SECRET, BODY, NOW);
  const forged = `t=${NOW + 10_000},v1=${real}`;
  const result = verifySignature({ secret: SECRET, body: BODY, header: forged, nowSeconds: NOW + 10_000 });
  assert.deepEqual(result, { ok: false, reason: 'no_match' });
});

test('a missing or malformed header is refused, not crashed on', () => {
  for (const header of [null, undefined, '', 'garbage', 'v1=', 't=abc']) {
    const r = verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW });
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(header)}`);
  }
  // A signature with no timestamp is a distinct failure from no signature.
  const sigOnly = verifySignature({ secret: SECRET, body: BODY, header: `v1=${signBody(SECRET, BODY, NOW)}`, nowSeconds: NOW });
  assert.equal(sigOnly.reason, 'missing_timestamp');
  assert.equal(verifySignature({ secret: SECRET, body: BODY, header: `t=${NOW}`, nowSeconds: NOW }).reason, 'missing_signature');
});

test('unknown keys are ignored so a future v2 cannot break a v1 receiver', () => {
  const header = `t=${NOW}, v2=deadbeef, v1=${signBody(SECRET, BODY, NOW)}, foo=bar`;
  assert.equal(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW }).ok, true);
});

test('several v1 signatures are all checked, so a secret can be rotated', () => {
  const header = `t=${NOW},v1=${signBody('whsec_old', BODY, NOW)},v1=${signBody(SECRET, BODY, NOW)}`;
  assert.equal(verifySignature({ secret: SECRET, body: BODY, header, nowSeconds: NOW }).ok, true);
});

test('comparing signatures of different lengths is false, not a throw', () => {
  assert.equal(signaturesMatch('abcd', 'abcdef'), false);
  assert.equal(signaturesMatch('', ''), false);
  assert.equal(signaturesMatch('abcd', 'abcd'), true);
});

test('a minted secret is distinctive and unique', () => {
  const a = mintWebhookSecret();
  assert.match(a, /^whsec_[0-9a-f]{48}$/);
  assert.notEqual(a, mintWebhookSecret());
});
