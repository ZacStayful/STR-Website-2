import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserParams, dedupeKeyFor, eventSourceUrl, isCustomEvent, isPostLaunch, purchaseFromTopup, subscribeFromInvoice } from './events.ts';

const SINCE = '2026-10-01T00:00:00Z';

test('one key per account for the journey events and Subscribe, one per payment for Purchase', () => {
  assert.equal(dedupeKeyFor('CompleteRegistration', { userId: 'u1' }), 'CompleteRegistration:u1');
  assert.equal(dedupeKeyFor('Subscribe', { userId: 'u1' }), 'Subscribe:u1');
  assert.equal(dedupeKeyFor('Purchase', { userId: 'u1', paymentIntentId: 'pi_9' }), 'Purchase:pi_9');
  assert.equal(dedupeKeyFor('Purchase', { userId: 'u1' }), null);
  assert.equal(dedupeKeyFor('FirstReport', { userId: '' }), null);
});

test('our two own events go through trackCustom', () => {
  assert.equal(isCustomEvent('ProfileComplete'), true);
  assert.equal(isCustomEvent('FirstReport'), true);
  assert.equal(isCustomEvent('Purchase'), false);
});

test('the page a server event is reported against never has a query string', () => {
  assert.equal(eventSourceUrl('Purchase', 'https://intelligence.stayful.co.uk/'), 'https://intelligence.stayful.co.uk/account/billing');
  assert.equal(eventSourceUrl('CompleteRegistration', 'https://x.test'), 'https://x.test/signup');
});

test('only accounts created after tracking began count for the journey events', () => {
  assert.equal(isPostLaunch('2026-10-02T09:00:00Z', SINCE), true);
  assert.equal(isPostLaunch('2026-09-20T09:00:00Z', SINCE), false);
  assert.equal(isPostLaunch('2026-10-02T09:00:00Z', null), false);
});

test('Subscribe: the first paid invoice of a subscription started after launch, ex-VAT', () => {
  const base = { amountPaid: 4799, totalExcludingTax: 3999, billingReason: 'subscription_create', currency: 'gbp', subscriptionStartedAt: '2026-10-05T10:00:00Z' };
  assert.deepEqual(subscribeFromInvoice(base, SINCE), { valuePence: 3999, currency: 'GBP' });
  // A 100%-off first month pays nothing: not yet.
  assert.equal(subscribeFromInvoice({ ...base, amountPaid: 0, totalExcludingTax: 0 }, SINCE), null);
  // Its next (paid) invoice is the one that counts.
  assert.deepEqual(subscribeFromInvoice({ ...base, billingReason: 'subscription_cycle' }, SINCE), { valuePence: 3999, currency: 'GBP' });
  // A plan change's proration invoice is never a Subscribe.
  assert.equal(subscribeFromInvoice({ ...base, billingReason: 'subscription_update' }, SINCE), null);
  // An existing subscriber's renewal never is.
  assert.equal(subscribeFromInvoice({ ...base, billingReason: 'subscription_cycle', subscriptionStartedAt: '2026-03-01T00:00:00Z' }, SINCE), null);
  // Without the ex-VAT figure the amount paid is used.
  assert.deepEqual(subscribeFromInvoice({ ...base, totalExcludingTax: null, amountPaid: 1900 }, SINCE), { valuePence: 1900, currency: 'GBP' });
  assert.equal(subscribeFromInvoice({ ...base, currency: 'usd' }, SINCE), null);
});

test('Purchase: a top-up the member chose, never an automatic one', () => {
  assert.deepEqual(purchaseFromTopup({ kind: 'topup', auto: undefined, amountPence: '1000', currency: 'gbp' }), { valuePence: 1000, currency: 'GBP' });
  assert.equal(purchaseFromTopup({ kind: 'topup', auto: '1', amountPence: '1000', currency: 'gbp' }), null);
  assert.equal(purchaseFromTopup({ kind: 'plan', auto: undefined, amountPence: '1000', currency: 'gbp' }), null);
  assert.equal(purchaseFromTopup({ kind: 'topup', auto: undefined, amountPence: 'x', currency: 'gbp' }), null);
});

test('the browser sends a value only with the two payments', () => {
  assert.deepEqual(browserParams('Purchase', 1000), { value: 10, currency: 'GBP' });
  assert.deepEqual(browserParams('FirstReport', 1000), {});
  assert.deepEqual(browserParams('Subscribe', null), {});
});
