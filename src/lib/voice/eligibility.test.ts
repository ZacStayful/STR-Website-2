import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEligibility, type EligibilityInput } from './eligibility.ts';
import { DEFAULT_VOICE } from './settings.ts';

const MON_NOON = new Date('2026-10-05T11:00:00Z'); // 12:00 BST, Monday
const base = (o: Partial<EligibilityInput> = {}): EligibilityInput => ({
  type: 'low_credit',
  now: MON_NOON,
  settings: DEFAULT_VOICE,
  callsOn: true,
  isOwner: true,
  numberOk: true,
  autoTopupOn: false,
  joinedAt: new Date('2026-09-01T00:00:00Z'),
  placedToday: 0,
  otherInFlight: false,
  introToday: false,
  affordableSeconds: 400,
  ...o,
});

test('a member who qualifies is called', () => {
  assert.deepEqual(checkEligibility(base()), { ok: true });
  assert.deepEqual(checkEligibility(base({ type: 'intro' })), { ok: true });
});

test('a member who joined 2 days ago gets no low-credit call (blocked, recorded)', () => {
  const r = checkEligibility(base({ joinedAt: new Date(MON_NOON.getTime() - 2 * 86_400_000) }));
  assert.deepEqual(r, { ok: false, reason: 'first_days', skip: false });
  // Exactly 3 days in, the rule has passed.
  assert.deepEqual(checkEligibility(base({ joinedAt: new Date(MON_NOON.getTime() - 3 * 86_400_000) })), { ok: true });
});

test('no low-credit call on the intro call\'s day', () => {
  assert.deepEqual(checkEligibility(base({ introToday: true })), { ok: false, reason: 'intro_day', skip: false });
});

test('a second outbound call the same UK day is blocked; the intro waits for tomorrow', () => {
  assert.deepEqual(checkEligibility(base({ placedToday: 1 })), { ok: false, reason: 'daily_limit', skip: false });
  assert.deepEqual(checkEligibility(base({ type: 'intro', placedToday: 1 })), { ok: false, defer: 'next_day', reason: 'daily_limit' });
});

test('one call in flight', () => {
  assert.deepEqual(checkEligibility(base({ otherInFlight: true })), { ok: false, reason: 'in_flight', skip: false });
});

test('team members, calls off and auto top-up on are skips, not blocked rows', () => {
  assert.deepEqual(checkEligibility(base({ isOwner: false })), { ok: false, reason: 'not_owner', skip: true });
  assert.deepEqual(checkEligibility(base({ callsOn: false })), { ok: false, reason: 'calls_off', skip: true });
  assert.deepEqual(checkEligibility(base({ autoTopupOn: true })), { ok: false, reason: 'auto_topup_on', skip: true });
  // Auto top-up doesn't stop the intro.
  assert.deepEqual(checkEligibility(base({ type: 'intro', autoTopupOn: true })), { ok: true });
});

test('no verified number (or STOP sent): never called', () => {
  assert.deepEqual(checkEligibility(base({ numberOk: false })), { ok: false, reason: 'no_number', skip: false });
});

test('less than a minute of credit: no call', () => {
  assert.deepEqual(checkEligibility(base({ affordableSeconds: 59 })), { ok: false, reason: 'no_credit', skip: false });
});

test('outside weekday hours the call waits for the next opening', () => {
  assert.deepEqual(checkEligibility(base({ now: new Date('2026-10-05T18:30:00Z') })), { ok: false, defer: 'hours' });
  assert.deepEqual(checkEligibility(base({ now: new Date('2026-10-10T11:00:00Z') })), { ok: false, defer: 'hours' }); // Saturday
});

test('the limit at 0 stops every outbound call', () => {
  assert.deepEqual(checkEligibility(base({ settings: { ...DEFAULT_VOICE, maxOutboundPerUkDay: 0 } })), { ok: false, reason: 'daily_limit', skip: false });
});
