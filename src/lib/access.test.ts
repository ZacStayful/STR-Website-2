import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_RUNS,
  accessDenied,
  accountStatus,
  countsAgainstFreeTrial,
  freeReportsRemaining,
  hasAccess,
  isLapsedSubscriber,
  isOnFreeTrial,
  isPaid,
  isPauseScheduled,
  isPaused,
  isCancelScheduled,
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

test('a dead Stripe status beats a stale plan=pro column', () => {
  const p = profile({
    plan: 'pro',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'canceled',
  });
  assert.equal(accountStatus(p), 'lapsed');
  assert.equal(hasAccess(p), false);
});

// The escape hatch: a plan set by hand outranks Stripe in both directions,
// so a customer Stripe has wrong can always be fixed from the dashboard.
test('a manual grant outranks a dead Stripe status', () => {
  const p = profile({
    plan: 'pro',
    plan_source: 'manual',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'canceled',
  });
  assert.equal(accountStatus(p), 'paid');
  assert.equal(hasAccess(p), true);
});

test('plan_source=manual on a free plan grants nothing', () => {
  const p = profile({ plan: 'free', plan_source: 'manual' });
  assert.equal(accountStatus(p), 'free_trial');
});

test('an incomplete/expired checkout is not a paying customer', () => {
  for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
    const p = profile({ plan: 'pro', stripe_subscription_status: status });
    assert.equal(accountStatus(p), 'lapsed', status);
    assert.equal(hasAccess(p), false, status);
  }
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

// ---------------------------------------------------------------
// Self-serve pause window
// ---------------------------------------------------------------
// A pause is `from <= now < until`. These tests pin down both ends, because
// each one is load-bearing: `from` is what lets a member keep the month they
// already paid for, and `until` is what restores access with no webhook and
// no cron.

const NOW = Date.parse('2026-06-15T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();
const DAY = 86_400_000;

// A live Stripe subscription — pause_collection does NOT change the status,
// so every case below stays 'active' and the pause columns do all the work.
function subscriber(over: P = {}): P {
  return profile({
    plan: 'pro',
    plan_source: 'stripe',
    stripe_subscription_id: 'sub_1',
    stripe_subscription_status: 'active',
    ...over,
  });
}

test('inside the pause window: no access', () => {
  const p = subscriber({
    subscription_paused_from: iso(NOW - 10 * DAY),
    subscription_paused_until: iso(NOW + 20 * DAY),
  });
  assert.equal(isPaused(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paused');
  assert.equal(hasAccess(p, NOW), false);
});

test('a pause booked for the end of the paid period does not bite yet', () => {
  const p = subscriber({
    subscription_paused_from: iso(NOW + 10 * DAY),
    subscription_paused_until: iso(NOW + 100 * DAY),
  });
  assert.equal(isPaused(p, NOW), false);
  assert.equal(isPauseScheduled(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paid');
  assert.equal(hasAccess(p, NOW), true);
});

test('an elapsed pause restores access with no webhook', () => {
  // The row still carries the old window because the resume event never
  // arrived. Access must come back anyway, purely from the clock.
  const p = subscriber({
    subscription_paused_from: iso(NOW - 100 * DAY),
    subscription_paused_until: iso(NOW - 1 * DAY),
  });
  assert.equal(isPaused(p, NOW), false);
  assert.equal(accountStatus(p, NOW), 'paid');
  assert.equal(hasAccess(p, NOW), true);
});

test('pause window boundaries are half-open', () => {
  const at = (from: number, until: number) =>
    isPaused(subscriber({ subscription_paused_from: iso(from), subscription_paused_until: iso(until) }), NOW);
  // now === from: the pause has started.
  assert.equal(at(NOW, NOW + DAY), true);
  // now === until: the pause is over.
  assert.equal(at(NOW - DAY, NOW), false);
});

test('a half-written or malformed pause window is not a pause', () => {
  // Failing towards access is deliberate: a bad row must never lock out
  // somebody who is paying.
  const cases: P[] = [
    { subscription_paused_from: iso(NOW - DAY), subscription_paused_until: null },
    { subscription_paused_from: null, subscription_paused_until: iso(NOW + DAY) },
    { subscription_paused_from: 'not a date', subscription_paused_until: iso(NOW + DAY) },
    { subscription_paused_from: iso(NOW - DAY), subscription_paused_until: '' },
  ];
  for (const over of cases) {
    const p = subscriber(over);
    assert.equal(isPaused(p, NOW), false, JSON.stringify(over));
    assert.equal(hasAccess(p, NOW), true, JSON.stringify(over));
  }
});

test('a profile selected without the pause columns is not paused', () => {
  // The Supabase client is untyped, so a select that omits these reads as
  // undefined. That must not silently grant access — see ACCESS_COLUMNS.
  const p: P = { plan: 'pro', plan_source: 'stripe', stripe_subscription_status: 'active' };
  assert.equal(isPaused(p, NOW), false);
  assert.equal(accountStatus(p, NOW), 'paid');
});

test('paused outranks a manual plan grant', () => {
  // plan_source='manual' normally beats anything Stripe says. It must not
  // rescue a member who asked us to pause them.
  const p = profile({
    plan: 'pro',
    plan_source: 'manual',
    stripe_subscription_id: 'sub_1',
    subscription_paused_from: iso(NOW - DAY),
    subscription_paused_until: iso(NOW + DAY),
  });
  assert.equal(accountStatus(p, NOW), 'paused');
  assert.equal(hasAccess(p, NOW), false);
});

test('a paused member is not a subscriber and has no free-report count', () => {
  const p = subscriber({
    subscription_paused_from: iso(NOW - DAY),
    subscription_paused_until: iso(NOW + DAY),
  });
  assert.equal(isSubscriber(p, NOW), false);
  assert.equal(isPaid(p, NOW), false);
  assert.equal(isOnFreeTrial(p, NOW), false);
  assert.equal(isLapsedSubscriber(p, NOW), false);
  // They never had a trial, so there is no allowance to advertise.
  assert.equal(freeReportsRemaining(p, NOW), null);
  assert.equal(countsAgainstFreeTrial(p, NOW), false);
});

test('a scheduled cancellation keeps full access until the date', () => {
  const p = subscriber({ subscription_cancel_at: iso(NOW + 10 * DAY) });
  assert.equal(isCancelScheduled(p, NOW), true);
  assert.equal(accountStatus(p, NOW), 'paid');
  assert.equal(hasAccess(p, NOW), true);
});

test('a cancellation date in the past is no longer scheduled', () => {
  // Stripe has deleted the subscription by now; the status is what decides.
  const p = subscriber({
    stripe_subscription_status: 'canceled',
    subscription_cancel_at: iso(NOW - DAY),
  });
  assert.equal(isCancelScheduled(p, NOW), false);
  assert.equal(accountStatus(p, NOW), 'lapsed');
  assert.equal(hasAccess(p, NOW), false);
});

test('no cancellation date means nothing is scheduled', () => {
  assert.equal(isCancelScheduled(subscriber(), NOW), false);
  assert.equal(isPauseScheduled(subscriber(), NOW), false);
});

// ---------------------------------------------------------------
// 402 bodies
// ---------------------------------------------------------------

test('a paused member is sent to /account, never to checkout', () => {
  // Following a checkout link with a live subscription starts a SECOND one and
  // bills them twice. This is the whole reason accessDenied exists.
  const p = subscriber({
    subscription_paused_from: iso(NOW - DAY),
    subscription_paused_until: iso(NOW + DAY),
  });
  const denied = accessDenied(p, 'listing checks', NOW);
  assert.equal(denied.upgradeUrl, '/account');
  assert.equal(denied.code, 'paused');
  assert.match(denied.error, /paused/);
  assert.match(denied.error, /listing checks/);
});

test('a lapsed member is sent to /upgrade', () => {
  const p = subscriber({ stripe_subscription_status: 'canceled' });
  const denied = accessDenied(p, 'area reports', NOW);
  assert.equal(denied.upgradeUrl, '/upgrade');
  assert.equal(denied.code, 'lapsed');
});

test('a used-up trial is sent to /upgrade, and a missing profile degrades safely', () => {
  const used = profile({ reports_run: FREE_RUNS });
  assert.equal(accessDenied(used, 'reports', NOW).upgradeUrl, '/upgrade');
  assert.equal(accessDenied(used, 'reports', NOW).code, 'trial_expired');

  const none = accessDenied(null, 'reports', NOW);
  assert.equal(none.upgradeUrl, '/upgrade');
  assert.equal(none.code, 'unknown');
});
