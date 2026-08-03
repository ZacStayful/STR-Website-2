import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_RUNS,
  hasAccess,
  hasFreeRunsLeft,
  isLapsedSubscriber,
  isPro,
  runsRemaining,
} from './access.ts';

const free = { plan: 'free' as const, stripe_subscription_id: null };
const pro = { plan: 'pro' as const, stripe_subscription_id: 'sub_123' };
const lapsed = { plan: 'free' as const, stripe_subscription_id: 'sub_123' };

test('the free allowance is two reports', () => {
  assert.equal(FREE_RUNS, 2);
});

test('a new user has the full allowance', () => {
  assert.equal(runsRemaining(0), 2);
  assert.equal(hasFreeRunsLeft(0), true);
  assert.equal(hasAccess(free, 0), true);
});

test('access ends once the allowance is spent', () => {
  assert.equal(hasAccess(free, 1), true);
  assert.equal(runsRemaining(1), 1);
  assert.equal(hasAccess(free, 2), false);
  assert.equal(hasFreeRunsLeft(2), false);
});

test('remaining never goes negative', () => {
  assert.equal(runsRemaining(5), 0);
  assert.equal(runsRemaining(99), 0);
});

test('a pooled count from a second account still blocks', () => {
  // Hannah's case: one report on each of two accounts is still two in total,
  // so the second signup buys nothing.
  assert.equal(hasAccess(free, 1 + 1), false);
});

test('pro users are unlimited regardless of usage', () => {
  assert.equal(isPro(pro), true);
  assert.equal(hasAccess(pro, 0), true);
  assert.equal(hasAccess(pro, 999), true);
});

test('lapsed subscribers go to the paywall, not back to the free tier', () => {
  assert.equal(isLapsedSubscriber(lapsed), true);
  assert.equal(hasAccess(lapsed, 0), false);
});

test('a free user who never subscribed is not treated as lapsed', () => {
  assert.equal(isLapsedSubscriber(free), false);
});
