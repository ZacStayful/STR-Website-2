import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recheckBillFor, type RecheckWatcher } from './recheck-billing.ts';

const w = (over: Partial<RecheckWatcher> & { userId: string }): RecheckWatcher => ({ away: false, suspended: false, payerId: over.userId, memberId: null, canPay: true, ...over });

test('Batch 21 (B16, D16): the first watcher who can pay carries the fetch', () => {
  assert.deepEqual(recheckBillFor([w({ userId: 'a' }), w({ userId: 'b' })]), { userId: 'a', memberId: null });
});

test('a member away (picks paused for inactivity) is passed over', () => {
  assert.deepEqual(recheckBillFor([w({ userId: 'a', away: true }), w({ userId: 'b' })]), { userId: 'b', memberId: null });
  assert.equal(recheckBillFor([w({ userId: 'a', away: true })]), null);
});

test('a payer at £0 under enforcement is passed over', () => {
  assert.deepEqual(recheckBillFor([w({ userId: 'a', canPay: false }), w({ userId: 'b' })]), { userId: 'b', memberId: null });
  assert.equal(recheckBillFor([w({ userId: 'a', canPay: false })]), null);
});

test('a team member bills their owner', () => {
  assert.deepEqual(recheckBillFor([w({ userId: 'm', payerId: 'owner', memberId: 'm' })]), { userId: 'owner', memberId: 'm' });
});

test('a paused seat alone is read on the house, as before; a paying watcher wins over it', () => {
  assert.deepEqual(recheckBillFor([w({ userId: 'm', payerId: 'owner', memberId: 'm', suspended: true })]), { userId: null, memberId: 'm' });
  assert.deepEqual(recheckBillFor([w({ userId: 'm', payerId: 'owner', memberId: 'm', suspended: true }), w({ userId: 'b' })]), { userId: 'b', memberId: null });
});

test('nobody watching means nothing to bill', () => {
  assert.equal(recheckBillFor([]), null);
});
