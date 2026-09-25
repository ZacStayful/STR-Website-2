import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_COLUMNS,
  accessDenied,
  accountStatus,
  hasEverPaid,
  PAID_TIER_COLUMNS,
  isCancelScheduled,
  isLapsedSubscriber,
  isPaid,
  isPauseScheduled,
  isPaused,
  isPro,
  isSubscriber,
  planName,
} from './access.ts';

type P = Parameters<typeof accountStatus>[0];

// Minimal profile builder — mirrors what the app selects (ACCESS_COLUMNS).
function profile(over: P = {}): P {
  return {
    plan: 'free',
    plan_code: null,
    reports_run: 0,
    stripe_subscription_id: null,
    stripe_subscription_status: null,
    ...over,
  };
}

test('a brand new user is pay-as-you-go, not a subscriber', () => {
  const p = profile();
  assert.equal(accountStatus(p), 'free');
  assert.equal(isSubscriber(p), false);
  assert.equal(isPro(p), false);
  assert.equal(planName(null), 'Pay as you go');
});

test('a paying subscriber is paid', () => {
  const p = profile({ plan: 'pro', plan_code: 'pro', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active' });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(isPaid(p), true);
  assert.equal(isSubscriber(p), true);
  assert.equal(isPro(p), true);
  assert.equal(planName('pro'), 'Pro');
});

test('a live Stripe subscription wins over a stale plan=free column', () => {
  const p = profile({ plan: 'free', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active' });
  assert.equal(accountStatus(p), 'paid');
});

test('a manually granted plan with no Stripe record still counts as paid', () => {
  assert.equal(accountStatus(profile({ plan: 'pro' })), 'paid');
  assert.equal(accountStatus(profile({ plan_code: 'starter' })), 'paid');
});

test('a dead Stripe status beats a stale plan=pro column', () => {
  const p = profile({ plan: 'pro', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' });
  assert.equal(accountStatus(p), 'lapsed');
  assert.equal(isLapsedSubscriber(p), true);
});

test('a manual grant outranks a dead Stripe status', () => {
  const p = profile({ plan: 'pro', plan_source: 'manual', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' });
  assert.equal(accountStatus(p), 'paid');
});

test('plan_source=manual on a free plan grants nothing', () => {
  assert.equal(accountStatus(profile({ plan: 'free', plan_source: 'manual' })), 'free');
});

test('an incomplete/expired checkout is not a paying customer', () => {
  for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
    assert.equal(accountStatus(profile({ plan: 'pro', stripe_subscription_status: status })), 'lapsed', status);
  }
});

test('a Stripe free trial is a subscriber but not a paying customer', () => {
  const p = profile({ plan: 'pro', stripe_subscription_id: 'sub_1', stripe_subscription_status: 'trialing' });
  assert.equal(accountStatus(p), 'subscription_trial');
  assert.equal(isSubscriber(p), true);
  assert.equal(isPaid(p), false);
});

test('past_due is still a subscriber — a retrying card is not a cancellation', () => {
  const p = profile({ stripe_subscription_id: 'sub_1', stripe_subscription_status: 'past_due' });
  assert.equal(accountStatus(p), 'paid');
});

test('a cancelled subscriber is lapsed, never pay-as-you-go', () => {
  const p = profile({ stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' });
  assert.equal(accountStatus(p), 'lapsed');
});

test('a subscription id with no status is treated as history, not a fresh account', () => {
  assert.equal(accountStatus(profile({ stripe_subscription_id: 'sub_1' })), 'lapsed');
});

test('status comparison is case- and whitespace-insensitive', () => {
  assert.equal(accountStatus(profile({ stripe_subscription_status: ' Active ' })), 'paid');
});

// ---------------------------------------------------------------------------
// Pause and cancel
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-06-15T12:00:00Z');

test('inside a pause window the account is paused, whatever Stripe says', () => {
  const p = profile({
    plan: 'pro',
    plan_code: 'pro',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'active',
    subscription_paused_from: '2026-06-01T00:00:00Z',
    subscription_paused_until: '2026-09-01T00:00:00Z',
  });
  assert.equal(isPaused(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paused');
  assert.equal(isSubscriber(p, NOW), false);
});

test('a pause outranks a manual grant — they asked to pause', () => {
  const p = profile({
    plan: 'pro',
    plan_source: 'manual',
    subscription_paused_from: '2026-06-01T00:00:00Z',
    subscription_paused_until: '2026-09-01T00:00:00Z',
  });
  assert.equal(accountStatus(p, NOW), 'paused');
});

test('a pause booked for later is scheduled, not active', () => {
  const p = profile({
    stripe_subscription_status: 'active',
    subscription_paused_from: '2026-07-01T00:00:00Z',
    subscription_paused_until: '2026-08-01T00:00:00Z',
  });
  assert.equal(isPaused(p, NOW), false);
  assert.equal(isPauseScheduled(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paid');
});

test('an elapsed pause restores the plan by the clock alone', () => {
  const p = profile({
    stripe_subscription_status: 'active',
    subscription_paused_from: '2026-03-01T00:00:00Z',
    subscription_paused_until: '2026-04-01T00:00:00Z',
  });
  assert.equal(isPaused(p, NOW), false);
  assert.equal(isPauseScheduled(p, NOW), false);
  assert.equal(accountStatus(p, NOW), 'paid');
});

test('a window missing either end is not a pause', () => {
  assert.equal(isPaused(profile({ subscription_paused_until: '2026-09-01T00:00:00Z' }), NOW), false);
  assert.equal(isPaused(profile({ subscription_paused_from: '2026-06-01T00:00:00Z' }), NOW), false);
  assert.equal(isPaused(profile({ subscription_paused_from: 'not a date', subscription_paused_until: '2026-09-01T00:00:00Z' }), NOW), false);
});

test('a scheduled cancellation keeps the member paid until the date', () => {
  const p = profile({ stripe_subscription_status: 'active', subscription_cancel_at: '2026-07-01T00:00:00Z' });
  assert.equal(isCancelScheduled(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paid');
  assert.equal(isCancelScheduled(p, Date.parse('2026-07-02T00:00:00Z')), false);
});

test('ACCESS_COLUMNS names every column the status reads', () => {
  for (const col of ['plan', 'plan_code', 'plan_source', 'stripe_subscription_status', 'subscription_paused_from', 'subscription_paused_until', 'subscription_cancel_at']) {
    assert.ok(ACCESS_COLUMNS.split(/,\s*/).includes(col), col);
  }
});

test('accessDenied explains a missing profile without sending them to checkout twice', () => {
  const missing = accessDenied(null, 'listing checks');
  assert.equal(missing.code, 'unknown');
  assert.match(missing.error, /listing checks/);
  assert.equal(accessDenied(profile(), 'x').code, 'free');
});

test('hasEverPaid: welcome, referral or adjustment credit only is free', () => {
  assert.equal(hasEverPaid(profile()), false);
  assert.equal(hasEverPaid(null), false);
  assert.equal(hasEverPaid(undefined), false);
});

test('hasEverPaid: any subscription ever counts, whatever its state today', () => {
  assert.equal(hasEverPaid(profile({ stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active' })), true);
  assert.equal(hasEverPaid(profile({ stripe_subscription_id: 'sub_1', stripe_subscription_status: 'canceled' })), true);
  assert.equal(hasEverPaid(profile({ stripe_subscription_status: 'past_due' })), true);
  assert.equal(hasEverPaid({ ...profile(), subscription_started_at: '2026-01-01T00:00:00Z' }), true);
  // Paused: the Stripe status stays active and the pause window is on the row.
  assert.equal(hasEverPaid(profile({ stripe_subscription_id: 'sub_1', stripe_subscription_status: 'active', subscription_paused_from: '2026-01-01T00:00:00Z', subscription_paused_until: '2099-01-01T00:00:00Z' })), true);
});

test('hasEverPaid: a plan granted by hand and a top-up both count', () => {
  assert.equal(hasEverPaid(profile({ plan: 'pro' })), true);
  assert.equal(hasEverPaid(profile({ plan_code: 'starter' })), true);
  assert.equal(hasEverPaid({ ...profile(), last_topup_at: '2026-09-01T00:00:00Z' }), true);
});

test('hasEverPaid: admins count as paid whatever the row says', () => {
  assert.equal(hasEverPaid(profile(), { admin: true }), true);
  assert.equal(hasEverPaid(null, { admin: true }), true);
  assert.equal(hasEverPaid(profile(), { admin: false }), false);
});

test('PAID_TIER_COLUMNS names every column the rule reads and nothing the access gate does not already have', () => {
  for (const col of ['plan', 'plan_code', 'stripe_subscription_id', 'stripe_subscription_status', 'subscription_started_at', 'last_topup_at']) {
    assert.ok(PAID_TIER_COLUMNS.split(', ').includes(col), col);
  }
  assert.equal(PAID_TIER_COLUMNS.includes('subscription_paused'), false);
});
