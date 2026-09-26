import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWith } from '../crypto/sign.ts';
import { fitsOneSegment } from './gsm.ts';
import {
  CODE_TTL_MS, codePayload, codeText, MAX_ATTEMPTS, newCode, normaliseCode, resendMessage, resendVerdict, sameHash, verificationOpen,
} from './verify.ts';

const NOW = new Date('2026-09-26T10:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const S = 1000;
const M = 60 * S;
const H = 60 * M;

test('a code is always six digits, leading zeros kept', () => {
  assert.equal(newCode(() => 42), '000042');
  assert.equal(newCode(() => 999999), '999999');
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^\d{6}$/);
});

test('the member may type spaces or a dash; anything else is not a code', () => {
  assert.equal(normaliseCode('123 456'), '123456');
  assert.equal(normaliseCode('123-456'), '123456');
  assert.equal(normaliseCode('12345'), null);
  assert.equal(normaliseCode('1234567'), null);
  assert.equal(normaliseCode('abcdef'), null);
  assert.equal(normaliseCode(undefined), null);
});

test('a hash is bound to its verification: the same code under another id does not match', () => {
  const key = 'k'.repeat(32);
  const h = signWith(key, codePayload('v1', '123456'));
  assert.equal(sameHash(h, signWith(key, codePayload('v1', '123456'))), true);
  assert.equal(sameHash(h, signWith(key, codePayload('v2', '123456'))), false);
  assert.equal(sameHash(h, signWith(key, codePayload('v1', '123457'))), false);
  assert.equal(sameHash(h, null), false);
  assert.equal(sameHash('', ''), false);
});

test('a verification is open for 10 minutes and 5 guesses, until verified or replaced', () => {
  const base = { expires_at: new Date(NOW.getTime() + CODE_TTL_MS).toISOString(), attempts: 0, verified_at: null, superseded_at: null };
  assert.equal(verificationOpen(base, NOW), true);
  assert.equal(verificationOpen({ ...base, attempts: MAX_ATTEMPTS - 1 }, NOW), true);
  assert.equal(verificationOpen({ ...base, attempts: MAX_ATTEMPTS }, NOW), false);
  assert.equal(verificationOpen(base, new Date(NOW.getTime() + CODE_TTL_MS)), false);
  assert.equal(verificationOpen({ ...base, verified_at: NOW.toISOString() }, NOW), false);
  assert.equal(verificationOpen({ ...base, superseded_at: NOW.toISOString() }, NOW), false);
});

test('first code: always allowed', () => {
  assert.deepEqual(resendVerdict([], [], NOW), { ok: true });
});

test('a resend within 60 seconds is refused with the wait', () => {
  const v = resendVerdict([ago(20 * S)], [ago(20 * S)], NOW);
  assert.deepEqual(v, { ok: false, reason: 'too_soon', retryAfterSeconds: 40 });
  assert.deepEqual(resendVerdict([ago(61 * S)], [ago(61 * S)], NOW), { ok: true });
});

test('at most 3 codes an hour per member', () => {
  const sends = [ago(2 * M), ago(20 * M), ago(40 * M)];
  const v = resendVerdict(sends, sends, NOW);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, 'hourly_limit');
  assert.equal(!v.ok && v.retryAfterSeconds, 20 * 60); // the oldest of the three leaves the hour in 20 minutes
});

test('at most 5 codes a day per member', () => {
  const sends = [ago(2 * H), ago(4 * H), ago(6 * H), ago(8 * H), ago(10 * H)];
  const v = resendVerdict(sends, [], NOW);
  assert.equal(!v.ok && v.reason, 'daily_limit');
  assert.deepEqual(resendVerdict(sends.slice(0, 4), [], NOW), { ok: true });
  assert.deepEqual(resendVerdict([ago(25 * H), ...sends.slice(0, 4)], [], NOW), { ok: true }); // older than a day does not count
});

test('at most 5 codes a day to one number, across every account', () => {
  const other = [ago(1 * H), ago(3 * H), ago(5 * H), ago(7 * H), ago(9 * H)];
  const v = resendVerdict([], other, NOW);
  assert.equal(!v.ok && v.reason, 'number_limit');
});

test('refusals are explained in plain words', () => {
  assert.equal(resendMessage({ ok: false, reason: 'too_soon', retryAfterSeconds: 40 }), 'Please wait 40 seconds before asking for another code.');
  assert.match(resendMessage({ ok: false, reason: 'hourly_limit', retryAfterSeconds: 1200 }), /20 minutes/);
  assert.match(resendMessage({ ok: false, reason: 'daily_limit', retryAfterSeconds: 10 * 3600 }), /10 hours/);
});

test('the code text is one plain segment and ends with the opt-out', () => {
  const text = codeText('012345');
  assert.equal(fitsOneSegment(text), true);
  assert.match(text, /Reply STOP to opt out$/);
  assert.match(text, /012345/);
});
