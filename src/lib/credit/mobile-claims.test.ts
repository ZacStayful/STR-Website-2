import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskNumber, planMobileClaims, type MobileAccount } from './mobile-claims.ts';

const acct = (id: string, createdAt: string, mobile: string | null, mobileKey: string | null = null, email = `${id}@x.com`): MobileAccount => ({ id, email, createdAt, mobile, mobileKey });

test('every account with a number gets its key; nothing to do when they already hold it', () => {
  const plan = planMobileClaims([acct('a', '2026-07-01', '07700 900001'), acct('b', '2026-07-02', '+44 7700 900002', '+447700900002'), acct('c', '2026-07-03', null)]);
  assert.equal(plan.accounts, 3);
  assert.equal(plan.withNumber, 2);
  assert.equal(plan.keys.length, 2);
  assert.deepEqual(plan.changes.map((k) => [k.key, k.keeper.id, k.setKeeper]), [['+447700900001', 'a', true]]);
  assert.equal(plan.clashes.length, 0);
});

test('a shared number goes to the oldest account; the others are listed and nothing is taken from them but the key', () => {
  const plan = planMobileClaims([acct('new', '2026-09-01', '07700 900003'), acct('old', '2026-06-20', '(0)7700-900003'), acct('mid', '2026-08-01', '447700900003')]);
  assert.equal(plan.clashes.length, 1);
  const k = plan.clashes[0];
  assert.equal(k.key, '+447700900003');
  assert.equal(k.keeper.id, 'old');
  assert.deepEqual(k.others.map((a) => a.id), ['mid', 'new']);
  assert.deepEqual(k.takeFrom, []);
  assert.equal(k.setKeeper, true);
});

test('a newer account already holding a shared number loses it to the oldest', () => {
  const plan = planMobileClaims([acct('old', '2026-06-20', '07700900004'), acct('new', '2026-09-01', '07700900004', '+447700900004')]);
  const k = plan.clashes[0];
  assert.equal(k.keeper.id, 'old');
  assert.deepEqual(k.takeFrom, ['new']);
  assert.equal(plan.changes.length, 1);
});

test('an account holding one number is never given a second: the next oldest takes it', () => {
  // "x" holds +447700900005 from its welcome check but its mobile now reads 900006.
  const plan = planMobileClaims([acct('x', '2026-06-01', '07700900006', '+447700900005'), acct('y', '2026-07-01', '07700900006')]);
  const k6 = plan.keys.find((k) => k.key === '+447700900006')!;
  assert.equal(k6.keeper.id, 'y');
  assert.equal(k6.setKeeper, true);
  const k5 = plan.keys.find((k) => k.key === '+447700900005')!;
  assert.equal(k5.keeper.id, 'x');
  assert.equal(k5.setKeeper, false);
  assert.equal(plan.skipped.length, 0);
});

test('a number whose every claimant holds another key is reported, not written', () => {
  const plan = planMobileClaims([acct('x', '2026-06-01', '07700900007', '+447700900008')]);
  assert.deepEqual(plan.skipped.map((s) => [s.key, s.accountId, s.reason]), [['+447700900007', 'x', 'keeper_holds_other_key']]);
  assert.equal(plan.keys.find((k) => k.key === '+447700900007'), undefined);
});

test('ties on the creation time go to the lower id; an unknown date sorts last', () => {
  const plan = planMobileClaims([acct('b', '2026-06-01T00:00:00Z', '07700900009'), acct('a', '2026-06-01T00:00:00Z', '07700900009'), acct('0', '', '07700900009')]);
  assert.equal(plan.clashes[0].keeper.id, 'a');
  assert.deepEqual(plan.clashes[0].others.map((x) => x.id), ['b', '0']);
});

test('unreadable numbers are counted, never keyed', () => {
  const plan = planMobileClaims([acct('a', '2026-06-01', '12')]);
  assert.equal(plan.unreadable, 1);
  assert.equal(plan.keys.length, 0);
});

test('the report shows only the last three digits', () => {
  assert.equal(maskNumber('+447700900123'), '…123');
  assert.equal(maskNumber('+4'), '…');
});
