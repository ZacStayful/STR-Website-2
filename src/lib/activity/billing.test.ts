import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingAt, pauseSpans, subscriptionSpans, type BillingFacts } from './billing.ts';

const base: BillingFacts = {
  createdAt: '2026-01-01T00:00:00Z',
  planSource: null,
  status: null,
  subStarted: null,
  subEnded: null,
  pausedFrom: null,
  pausedUntil: null,
  payments: { first: null, before: null, list: [] },
  events: [],
};
const at = (iso: string) => new Date(iso);
const with_ = (over: Partial<BillingFacts>): BillingFacts => ({ ...base, ...over });

test('no payment and no subscription: never paid', () => {
  assert.deepEqual(billingAt(base, at('2026-09-01T00:00:00Z')), { category: 'never_paid', paidRecently: false });
});

test('a top-up makes a member paying; recent for 90 days', () => {
  const b = with_({ payments: { first: '2026-06-01T00:00:00Z', before: null, list: ['2026-06-01T00:00:00Z'] } });
  assert.deepEqual(billingAt(b, at('2026-06-20T00:00:00Z')), { category: 'paying', paidRecently: true });
  assert.deepEqual(billingAt(b, at('2026-09-15T00:00:00Z')), { category: 'paying', paidRecently: false });
  // Before the payment they had not paid.
  assert.equal(billingAt(b, at('2026-05-20T00:00:00Z')).category, 'never_paid');
});

test('the latest payment before the window still counts', () => {
  const b = with_({ payments: { first: '2026-03-01T00:00:00Z', before: '2026-05-20T00:00:00Z', list: [] } });
  assert.equal(billingAt(b, at('2026-07-01T00:00:00Z')).paidRecently, true);
  assert.equal(billingAt(b, at('2026-09-01T00:00:00Z')).paidRecently, false);
});

test("an active Stripe subscription counts as paid even when its invoices never reached us", () => {
  const b = with_({ status: 'active', subStarted: '2026-08-01T00:00:00Z' });
  assert.deepEqual(billingAt(b, at('2026-09-01T00:00:00Z')), { category: 'paying', paidRecently: true });
  assert.equal(billingAt(b, at('2026-07-01T00:00:00Z')).category, 'never_paid');
});

test('a live annual subscription is paid recently however long ago it charged', () => {
  const b = with_({ status: 'active', subStarted: '2026-01-10T00:00:00Z', payments: { first: '2026-01-10T00:00:00Z', before: '2026-01-10T00:00:00Z', list: [] } });
  assert.deepEqual(billingAt(b, at('2026-09-01T00:00:00Z')), { category: 'paying', paidRecently: true });
});

test('a trial that has not charged is not paying', () => {
  const b = with_({ status: 'trialing', subStarted: '2026-08-25T00:00:00Z' });
  assert.equal(billingAt(b, at('2026-09-01T00:00:00Z')).category, 'never_paid');
});

test('a plan set up by hand is not a paid subscription', () => {
  const b = with_({ planSource: 'manual', status: null, subStarted: '2026-02-01T00:00:00Z' });
  assert.equal(billingAt(b, at('2026-09-01T00:00:00Z')).category, 'never_paid');
  assert.deepEqual(subscriptionSpans(b), []);
});

test('inside a pause window: paused; a window missing an end is no pause', () => {
  const paused = with_({ status: 'active', subStarted: '2026-03-01T00:00:00Z', pausedFrom: '2026-08-20T00:00:00Z', pausedUntil: '2026-10-20T00:00:00Z' });
  assert.equal(billingAt(paused, at('2026-09-01T00:00:00Z')).category, 'paused');
  assert.equal(billingAt(paused, at('2026-09-01T00:00:00Z')).paidRecently, false);
  assert.equal(billingAt(paused, at('2026-08-01T00:00:00Z')).category, 'paying');
  const open = with_({ status: 'active', subStarted: '2026-03-01T00:00:00Z', pausedFrom: '2026-08-20T00:00:00Z' });
  assert.equal(billingAt(open, at('2026-09-01T00:00:00Z')).category, 'paying');
});

test('ended and not paid since: cancelled; a top-up afterwards: paying again', () => {
  const ended = with_({ status: 'canceled', subStarted: '2026-02-01T00:00:00Z', subEnded: '2026-06-01T00:00:00Z', payments: { first: '2026-02-01T00:00:00Z', before: null, list: ['2026-02-01T00:00:00Z'] } });
  assert.equal(billingAt(ended, at('2026-07-01T00:00:00Z')).category, 'cancelled');
  assert.equal(billingAt(ended, at('2026-05-01T00:00:00Z')).category, 'paying');
  const back = with_({ ...ended, payments: { first: '2026-02-01T00:00:00Z', before: null, list: ['2026-02-01T00:00:00Z', '2026-07-10T00:00:00Z'] } });
  assert.deepEqual(billingAt(back, at('2026-08-01T00:00:00Z')), { category: 'paying', paidRecently: true });
  // A trial that ended is cancelled too: their subscription ended.
  const trialEnded = with_({ status: 'canceled', subStarted: '2026-02-01T00:00:00Z', subEnded: '2026-02-15T00:00:00Z' });
  assert.equal(billingAt(trialEnded, at('2026-03-01T00:00:00Z')).category, 'cancelled');
});

test('a cancellation booked for later is still paying until it ends', () => {
  const booked = with_({ status: 'active', subStarted: '2026-02-01T00:00:00Z', subEnded: null });
  assert.equal(billingAt(booked, at('2026-09-01T00:00:00Z')).category, 'paying');
});

test('subscription history comes from the events; a doubled start is one subscription', () => {
  const b = with_({
    status: 'active',
    subStarted: '2026-06-01T00:00:00Z',
    events: [
      { k: 'started', at: '2026-01-05T00:00:00Z' },
      { k: 'started', at: '2026-01-05T00:00:01Z' },
      { k: 'ended', at: '2026-03-01T00:00:00Z' },
      { k: 'started', at: '2026-06-01T00:00:00Z' },
    ],
    payments: { first: '2026-01-05T00:00:00Z', before: null, list: ['2026-01-05T00:00:00Z', '2026-06-01T00:00:00Z'] },
  });
  assert.deepEqual(subscriptionSpans(b).map((s) => [s.from, s.to]), [
    [Date.parse('2026-01-05T00:00:00Z'), Date.parse('2026-03-01T00:00:00Z')],
    [Date.parse('2026-06-01T00:00:00Z'), null],
  ]);
  assert.equal(billingAt(b, at('2026-04-01T00:00:00Z')).category, 'cancelled');
  assert.equal(billingAt(b, at('2026-07-01T00:00:00Z')).category, 'paying');
});

test('pause history comes from the events too', () => {
  const b = with_({
    status: 'active',
    subStarted: '2026-01-01T00:00:00Z',
    events: [{ k: 'paused', at: '2026-04-01T00:00:00Z' }, { k: 'resumed', at: '2026-05-01T00:00:00Z' }],
  });
  assert.equal(pauseSpans(b).length, 1);
  assert.equal(billingAt(b, at('2026-04-15T00:00:00Z')).category, 'paused');
  assert.equal(billingAt(b, at('2026-05-15T00:00:00Z')).category, 'paying');
});
