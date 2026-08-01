import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_RUNS,
  accountStatus,
  countsAgainstFreeTrial,
  freeReportsRemaining,
  hasAccess,
  isLapsedSubscriber,
  isOnFreeTrial,
  isPaid,
  isSubscriber,
} from './access.ts';

type P = Parameters<typeof accountStatus>[0];

// Minimal profile builder — mirrors what the app selects (ACCESS_COLUMNS).
function profile(over: P = {}): P {
  return {
    plan: 'free',
    reports_run: 0,
    stripe_subscription_id: null,
    stripe_subscription_status: null,
    ...over,
  };
}

test('a brand new user is on the free trial with all reports left', () => {
  const p = profile();
  assert.equal(accountStatus(p), 'free_trial');
  assert.equal(freeReportsRemaining(p), FREE_RUNS);
  assert.equal(hasAccess(p), true);
  assert.equal(countsAgainstFreeTrial(p), true);
});

test('free trial runs out after FREE_RUNS reports', () => {
  const p = profile({ reports_run: FREE_RUNS });
  assert.equal(accountStatus(p), 'trial_expired');
  assert.equal(hasAccess(p), false);
  assert.equal(freeReportsRemaining(p), null);
});

test('a paying subscriber is paid, not on a trial', () => {
  const p = profile({
    plan: 'pro',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'active',
  });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(isPaid(p), true);
  assert.equal(isSubscriber(p), true);
  assert.equal(isOnFreeTrial(p), false);
  assert.equal(hasAccess(p), true);
});

// This is the reported bug: the customer paid, the plan write never landed,
// and the app kept counting down their free reports.
test('a live Stripe subscription wins over a stale plan=free column', () => {
  const p = profile({
    plan: 'free',
    reports_run: 2,
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'active',
  });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(isSubscriber(p), true);
  // No free-report count exists for a subscriber, so trial copy can't render.
  assert.equal(freeReportsRemaining(p), null);
  assert.equal(countsAgainstFreeTrial(p), false);
});

test('a manually granted plan with no Stripe record still counts as paid', () => {
  const p = profile({ plan: 'pro' });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(isSubscriber(p), true);
  assert.equal(freeReportsRemaining(p), null);
});

test('a Stripe free trial is a subscriber but not a paying customer', () => {
  const p = profile({
    plan: 'pro',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'trialing',
  });
  assert.equal(accountStatus(p), 'subscription_trial');
  assert.equal(isSubscriber(p), true);
  assert.equal(isPaid(p), false);
  assert.equal(hasAccess(p), true);
  assert.equal(countsAgainstFreeTrial(p), false);
});

test('past_due keeps access — a retrying card is not a cancellation', () => {
  const p = profile({
    plan: 'free', // webhook may have flipped this before we widened the rule
    reports_run: 40,
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'past_due',
  });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(hasAccess(p), true);
});

test('a cancelled subscriber is lapsed, never a free-trial user', () => {
  const p = profile({
    plan: 'free',
    reports_run: 0,
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'canceled',
  });
  assert.equal(accountStatus(p), 'lapsed');
  assert.equal(isLapsedSubscriber(p), true);
  // Even with 0 reports run, they do NOT fall back onto the free allowance.
  assert.equal(hasAccess(p), false);
  assert.equal(freeReportsRemaining(p), null);
});

test('subscription history alone (no status) still means lapsed', () => {
  const p = profile({ stripe_subscription_id: 'sub_1' });
  assert.equal(accountStatus(p), 'lapsed');
  assert.equal(hasAccess(p), false);
});

test('status matching is case- and whitespace-insensitive', () => {
  const p = profile({ stripe_subscription_status: ' Active ' });
  assert.equal(accountStatus(p), 'paid');
});

test('subscribers never burn a free-report credit', () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    const p = profile({ stripe_subscription_status: status });
    assert.equal(countsAgainstFreeTrial(p), false, status);
  }
});

test('a partially selected profile degrades safely to free trial', () => {
  assert.equal(accountStatus({}), 'free_trial');
  assert.equal(freeReportsRemaining({}), FREE_RUNS);
});
