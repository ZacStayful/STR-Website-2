import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, nudgeDue, type NudgeInput } from './nudge.ts';

const NOW = new Date('2026-10-09T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const input = (o: Partial<NudgeInput> = {}): NudgeInput => ({
  balancePence: 480,
  lowCreditPence: 500,
  landing: { id: 'g1', amountPence: 2_500, landedAt: daysAgo(12) },
  now: NOW,
  minDays: 8,
  maxDays: 21,
  autoTopupOn: false,
  reengageSince: null,
  lowCreditCallPlaced: false,
  nudgedThisLanding: false,
  canText: true,
  canEmail: true,
  ...o,
});

test('a member who took 8–21 days to reach £5 is nudged', () => {
  assert.deepEqual(nudgeDue(input()), { due: true, daysToLow: 12 });
  assert.deepEqual(nudgeDue(input({ landing: { id: 'g1', amountPence: 2_500, landedAt: daysAgo(8) } })), { due: true, daysToLow: 8 });
  assert.deepEqual(nudgeDue(input({ landing: { id: 'g1', amountPence: 2_500, landedAt: daysAgo(21.9) } })), { due: true, daysToLow: 21 });
});

test('faster than 8 days is the low-credit call\'s; slower than 21 days gets the usual £5 notice', () => {
  assert.deepEqual(nudgeDue(input({ landing: { id: 'g1', amountPence: 2_500, landedAt: daysAgo(7.9) } })), { due: false, reason: 'too_soon' });
  assert.deepEqual(nudgeDue(input({ landing: { id: 'g1', amountPence: 2_500, landedAt: daysAgo(22) } })), { due: false, reason: 'too_late' });
});

test('not at £5, no credit landed, auto top-up on, gone quiet, or an admin: no nudge', () => {
  assert.deepEqual(nudgeDue(input({ balancePence: 501 })), { due: false, reason: 'not_low' });
  assert.deepEqual(nudgeDue(input({ lowCreditPence: 0 })), { due: false, reason: 'not_low' });
  assert.deepEqual(nudgeDue(input({ landing: null })), { due: false, reason: 'no_landing' });
  assert.deepEqual(nudgeDue(input({ autoTopupOn: true })), { due: false, reason: 'auto_topup_on' });
  assert.deepEqual(nudgeDue(input({ reengageSince: '2026-10-01T00:00:00Z' })), { due: false, reason: 'quiet' });
  assert.deepEqual(nudgeDue(input({ admin: true })), { due: false, reason: 'admin' });
});

test('once per credit landing, never after a low-credit call for it, and only when something can reach them', () => {
  assert.deepEqual(nudgeDue(input({ lowCreditCallPlaced: true })), { due: false, reason: 'low_credit_call' });
  assert.deepEqual(nudgeDue(input({ nudgedThisLanding: true })), { due: false, reason: 'already' });
  assert.deepEqual(nudgeDue(input({ canText: false, canEmail: false })), { due: false, reason: 'unreachable' });
  assert.deepEqual(nudgeDue(input({ canText: false })), { due: true, daysToLow: 12 });
});

test('days are whole days since the credit landed', () => {
  assert.equal(daysSince(daysAgo(8.99), NOW), 8);
  assert.equal(daysSince(daysAgo(0), NOW), 0);
});
