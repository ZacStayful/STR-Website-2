import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_TOPUP_COOLDOWN_MS, runAutoTopup, type AutoTopupDeps, type AutoTopupProfile } from './auto-topup-core.ts';

const NOW = new Date('2026-10-01T09:00:00Z');

function profile(over: Partial<AutoTopupProfile> = {}): AutoTopupProfile {
  return {
    email: 'member@example.com',
    stripe_customer_id: 'cus_1',
    stripe_default_payment_method_id: 'pm_1',
    auto_topup_amount_pence: 2500,
    auto_topup_threshold_pence: 500,
    auto_topup_last_at: null,
    ...over,
  };
}

function fake(over: Partial<AutoTopupDeps> & { balance?: number; status?: string; claimed?: boolean; p?: AutoTopupProfile | null } = {}) {
  const calls: Record<string, unknown[]> = { charge: [], grantTopup: [], recordCharge: [], switchOff: [], cardNeedsUpdate: [], claim: [] };
  const deps: AutoTopupDeps = {
    configured: () => true,
    profile: async () => (over.p === undefined ? profile() : over.p),
    spendableBasePence: async () => over.balance ?? 100,
    claim: async (...args) => {
      calls.claim.push(args);
      return over.claimed ?? true;
    },
    charge: async (p) => {
      calls.charge.push(p);
      return { id: 'pi_1', status: over.status ?? 'succeeded' };
    },
    grantTopup: async (...args) => {
      calls.grantTopup.push(args);
    },
    recordCharge: async (...args) => {
      calls.recordCharge.push(args);
    },
    switchOff: async (...args) => {
      calls.switchOff.push(args);
    },
    cardNeedsUpdate: async (...args) => {
      calls.cardNeedsUpdate.push(args);
    },
    now: () => NOW,
    defaultThresholdPence: 2000,
    ...over,
  };
  return { deps, calls };
}

test('a balance under the threshold charges the saved card, grants the credit with the email (the receipt), and records it', async () => {
  const { deps, calls } = fake({ balance: 100 });
  assert.equal(await runAutoTopup('u1', deps), 'charged');
  assert.equal(calls.claim.length, 1);
  assert.deepEqual(calls.claim[0], ['u1', NOW.toISOString(), new Date(NOW.getTime() - AUTO_TOPUP_COOLDOWN_MS).toISOString()]);
  assert.deepEqual(calls.charge[0], { userId: 'u1', amountPence: 2500, customerId: 'cus_1', paymentMethodId: 'pm_1', idempotencyKey: `autotopup:u1:${NOW.toISOString().slice(0, 16)}` });
  // The receipt: the grant is told the email, every time.
  assert.deepEqual(calls.grantTopup[0], ['u1', 2500, 'pi:pi_1', { email: 'member@example.com' }]);
  assert.deepEqual(calls.recordCharge[0], ['u1', { id: 'pi_1', status: 'succeeded' }, 2500]);
  assert.equal(calls.switchOff.length, 0);
});

test('a member with no email is still granted the credit, with no receipt to send', async () => {
  const { deps, calls } = fake({ p: profile({ email: null }) });
  assert.equal(await runAutoTopup('u1', deps), 'charged');
  assert.deepEqual(calls.grantTopup[0], ['u1', 2500, 'pi:pi_1', { email: null }]);
});

test('nothing happens above the threshold, inside the cooldown, without a card, or when another debit won the claim', async () => {
  assert.equal(await runAutoTopup('u1', fake({ balance: 500 }).deps), 'skipped', 'at the threshold');
  assert.equal(await runAutoTopup('u1', fake({ balance: 2000, p: profile({ auto_topup_threshold_pence: null }) }).deps), 'skipped', 'the default threshold when none is set');
  assert.equal(await runAutoTopup('u1', fake({ p: profile({ auto_topup_last_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString() }) }).deps), 'skipped', 'five minutes after the last attempt');
  assert.equal(await runAutoTopup('u1', fake({ p: profile({ stripe_default_payment_method_id: null }) }).deps), 'skipped', 'no saved card');
  assert.equal(await runAutoTopup('u1', fake({ p: profile({ auto_topup_amount_pence: null }) }).deps), 'skipped', 'auto top-up off');
  assert.equal(await runAutoTopup('u1', fake({ p: null }).deps), 'skipped', 'no profile');
  assert.equal(await runAutoTopup('u1', fake({ configured: () => false }).deps), 'skipped', 'Stripe not configured');
  const lost = fake({ claimed: false });
  assert.equal(await runAutoTopup('u1', lost.deps), 'skipped', 'another debit claimed the slot');
  assert.equal(lost.calls.charge.length, 0);
});

test('a decline switches auto top-up off and asks for a new card; nothing is granted', async () => {
  const { deps, calls } = fake({ status: 'requires_action' });
  assert.equal(await runAutoTopup('u1', deps), 'failed');
  assert.equal(calls.grantTopup.length, 0);
  assert.equal(calls.recordCharge.length, 0);
  assert.deepEqual(calls.switchOff[0], ['u1']);
  assert.deepEqual(calls.cardNeedsUpdate[0], ['member@example.com']);
});

test('a charge that throws is a decline too, and the email failing does not change the outcome', async () => {
  const { deps, calls } = fake({
    charge: async () => {
      throw new Error('card_declined');
    },
    cardNeedsUpdate: async () => {
      throw new Error('resend down');
    },
  });
  assert.equal(await runAutoTopup('u1', deps), 'failed');
  assert.deepEqual(calls.switchOff, [['u1']]);
});
