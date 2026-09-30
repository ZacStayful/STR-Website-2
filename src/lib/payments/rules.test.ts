import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyValuePence, paymentFromIntent, paymentFromInvoice, paymentKindFor, totalPaidPence } from './rules.ts';

test('a PaymentIntent is ours only when its metadata says pack or top-up', () => {
  assert.equal(paymentKindFor({ kind: 'starter_pack' }), 'starter_pack');
  assert.equal(paymentKindFor({ kind: 'topup' }), 'topup');
  assert.equal(paymentKindFor({ kind: 'topup', auto: '1' }), 'auto_topup');
  assert.equal(paymentKindFor({ kind: 'invoice' }), null);
  assert.equal(paymentKindFor(null), null);
});

test('a payment row is keyed by the Stripe id and records what was charged, VAT included', () => {
  const pack = paymentFromIntent({ id: 'pi_1', amount: 1200, amount_received: 1200, currency: 'GBP', metadata: { kind: 'starter_pack', price_pence: '1000' } }, 'u1');
  assert.deepEqual(pack, { id: 'pi:pi_1', userId: 'u1', kind: 'starter_pack', amountPence: 1200, currency: 'gbp', planCode: null, paymentIntentId: 'pi_1' });
  assert.equal(paymentFromIntent({ id: 'pi_2', amount_received: 0, metadata: { kind: 'topup' } }, 'u1'), null);
  assert.equal(paymentFromIntent({ id: 'pi_3', amount_received: 1000, metadata: {} }, 'u1'), null);
  const inv = paymentFromInvoice({ id: 'in_1', amount_paid: 1900, currency: 'gbp' }, 'u1', 'starter');
  assert.deepEqual(inv, { id: 'inv:in_1', userId: 'u1', kind: 'subscription', amountPence: 1900, currency: 'gbp', planCode: 'starter', paymentIntentId: null });
  assert.equal(paymentFromInvoice({ id: 'in_2', amount_paid: 0 }, 'u1', 'starter'), null);
});

test('total paid is payments less refunds, never below zero', () => {
  assert.equal(totalPaidPence(2900, 0), 2900);
  assert.equal(totalPaidPence(2900, 1000), 1900);
  assert.equal(totalPaidPence(1000, 1500), 0);
  assert.equal(totalPaidPence(Number.NaN, 0), 0);
});

test('monthly value: the live plan a month, annual divided by twelve, nothing while paused or ended', () => {
  const starter = { pricePence: 1900, interval: 'month' as const };
  const annual = { pricePence: 36000, interval: 'year' as const };
  assert.equal(monthlyValuePence({ status: 'active', paused: false, plan: starter }), 1900);
  assert.equal(monthlyValuePence({ status: 'trialing', paused: false, plan: starter }), 1900);
  assert.equal(monthlyValuePence({ status: 'past_due', paused: false, plan: starter }), 1900);
  assert.equal(monthlyValuePence({ status: 'active', paused: false, plan: annual }), 3000);
  assert.equal(monthlyValuePence({ status: 'active', paused: true, plan: starter }), 0);
  assert.equal(monthlyValuePence({ status: 'canceled', paused: false, plan: starter }), 0);
  assert.equal(monthlyValuePence({ status: null, paused: false, plan: starter }), 0);
  assert.equal(monthlyValuePence({ status: 'active', paused: false, plan: null }), 0);
});
