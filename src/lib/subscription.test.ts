import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAUSED_FROM_KEY,
  addMonths,
  formatPlanDate,
  isPauseMonths,
  pauseWindow,
  subscriptionPeriodEnd,
  subscriptionStateFromStripe,
} from './subscription.ts';

// Stripe fixtures are hand-built: the SDK is a type-only import here, so these
// tests never touch the network or the package.
type Sub = Parameters<typeof subscriptionStateFromStripe>[0];

const unix = (s: string) => Math.floor(Date.parse(s) / 1000);

function sub(over: Record<string, unknown> = {}): Sub {
  return {
    status: 'active',
    start_date: unix('2026-01-14T00:00:00Z'),
    cancel_at: null,
    pause_collection: null,
    metadata: {},
    items: { data: [{ current_period_end: unix('2026-07-14T00:00:00Z') }] },
    ...over,
  } as unknown as Sub;
}

test('pause months accepts only 1, 2 and 3', () => {
  for (const ok of [1, 2, 3, '1', '3']) assert.equal(isPauseMonths(ok), true, String(ok));
  for (const bad of [0, 4, 12, -1, 1.5, '', null, undefined, 'two', NaN]) {
    assert.equal(isPauseMonths(bad), false, String(bad));
  }
});

test('addMonths clamps to the end of the target month', () => {
  // Plain setMonth would roll 31 Jan + 1 into 3 March, silently granting two
  // extra days of pause.
  const jan31 = new Date('2026-01-31T09:30:00Z');
  assert.equal(addMonths(jan31, 1).toISOString(), '2026-02-28T09:30:00.000Z');
  assert.equal(addMonths(jan31, 3).toISOString(), '2026-04-30T09:30:00.000Z');
  // Leap year.
  assert.equal(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString(), '2028-02-29T00:00:00.000Z');
  // Crossing a year boundary.
  assert.equal(addMonths(new Date('2026-12-31T00:00:00Z'), 2).toISOString(), '2027-02-28T00:00:00.000Z');
  // A day that exists in both months is untouched.
  assert.equal(addMonths(new Date('2026-06-15T00:00:00Z'), 1).toISOString(), '2026-07-15T00:00:00.000Z');
});

test('period end reads the subscription item, then the legacy top-level field', () => {
  assert.equal(subscriptionPeriodEnd(sub())?.toISOString(), '2026-07-14T00:00:00.000Z');
  // An account pinned to an older API version has no items[].current_period_end.
  const legacy = sub({ items: { data: [{}] }, current_period_end: unix('2026-08-01T00:00:00Z') });
  assert.equal(subscriptionPeriodEnd(legacy)?.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(subscriptionPeriodEnd(sub({ items: { data: [] } })), null);
});

test('the pause window starts at the period end, not today', () => {
  // This is the whole point: pausing on day 3 of a paid month must not forfeit
  // the other 27 days.
  const w = pauseWindow(sub(), 2);
  assert.equal(w?.from.toISOString(), '2026-07-14T00:00:00.000Z');
  assert.equal(w?.until.toISOString(), '2026-09-14T00:00:00.000Z');
});

test('no period end means no pause window — refuse rather than guess', () => {
  assert.equal(pauseWindow(sub({ items: { data: [] } }), 1), null);
});

test('a live subscription maps to active with no pause or cancel', () => {
  const s = subscriptionStateFromStripe(sub());
  assert.equal(s.status, 'active');
  assert.equal(s.active, true);
  assert.equal(s.pausedFrom, null);
  assert.equal(s.pausedUntil, null);
  assert.equal(s.cancelAt, null);
  assert.equal(s.currentPeriodEnd, '2026-07-14T00:00:00.000Z');
});

test('a paused subscription is not active even though Stripe still says active', () => {
  // pause_collection does NOT change subscription.status. Anything reading the
  // status alone would hand a paused member full access.
  const s = subscriptionStateFromStripe(
    sub({
      pause_collection: { behavior: 'void', resumes_at: unix('2026-09-14T00:00:00Z') },
      metadata: { [PAUSED_FROM_KEY]: '2026-07-14T00:00:00.000Z' },
    }),
  );
  assert.equal(s.status, 'active');
  assert.equal(s.active, false);
  assert.equal(s.pausedFrom, '2026-07-14T00:00:00.000Z');
  assert.equal(s.pausedUntil, '2026-09-14T00:00:00.000Z');
});

test('a pause applied in the Stripe dashboard takes effect immediately', () => {
  // No metadata, so no scheduled start. Falling back to start_date opens the
  // window at once and gives the same answer on every replay of the event.
  const s = subscriptionStateFromStripe(
    sub({ pause_collection: { behavior: 'void', resumes_at: unix('2026-09-14T00:00:00Z') } }),
  );
  assert.equal(s.pausedFrom, '2026-01-14T00:00:00.000Z');
  assert.equal(s.active, false);
});

test('an auto-resume clears the whole pause window', () => {
  // Stripe sends customer.subscription.updated with pause_collection: null.
  // Stale metadata must not keep the member locked out.
  const s = subscriptionStateFromStripe(
    sub({ pause_collection: null, metadata: { [PAUSED_FROM_KEY]: '2026-07-14T00:00:00.000Z' } }),
  );
  assert.equal(s.pausedFrom, null);
  assert.equal(s.pausedUntil, null);
  assert.equal(s.active, true);
});

test('a scheduled cancellation is still active until the date', () => {
  const s = subscriptionStateFromStripe(sub({ cancel_at: unix('2026-07-14T00:00:00Z') }));
  assert.equal(s.active, true);
  assert.equal(s.cancelAt, '2026-07-14T00:00:00.000Z');
});

test('undoing a cancellation clears the date', () => {
  assert.equal(subscriptionStateFromStripe(sub({ cancel_at: null })).cancelAt, null);
});

test('past_due stays active, canceled and unpaid do not', () => {
  // Stripe is still retrying the card on past_due; locking out a paying
  // customer on the first failed charge is the false paywall we avoid.
  assert.equal(subscriptionStateFromStripe(sub({ status: 'past_due' })).active, true);
  assert.equal(subscriptionStateFromStripe(sub({ status: 'trialing' })).active, true);
  for (const dead of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
    assert.equal(subscriptionStateFromStripe(sub({ status: dead })).active, false, dead);
  }
});

test('status is normalised', () => {
  assert.equal(subscriptionStateFromStripe(sub({ status: ' ACTIVE ' })).status, 'active');
  assert.equal(subscriptionStateFromStripe(sub({ status: ' ACTIVE ' })).active, true);
});

test('dates render as en-GB, and bad input renders as nothing', () => {
  assert.equal(formatPlanDate('2026-09-14T00:00:00.000Z'), '14 September 2026');
  for (const bad of [null, undefined, '', 'not a date']) {
    assert.equal(formatPlanDate(bad), null, String(bad));
  }
});

test('a subscription that has ended has no pause window', () => {
  // Found by driving the real API: Stripe leaves pause_collection in place on a
  // cancelled subscription, so someone who cancelled while a pause was booked
  // keeps a stale window. Access was never wrong — they are refused either way
  // — but the account page would call them "paused until <date>" and offer a
  // Resume button that acts on a deleted subscription.
  const stale = {
    pause_collection: { behavior: 'void', resumes_at: unix('2026-12-12T00:00:00Z') },
    metadata: { [PAUSED_FROM_KEY]: '2026-10-12T00:00:00.000Z' },
  };
  for (const dead of ['canceled', 'unpaid', 'incomplete_expired']) {
    const s = subscriptionStateFromStripe(sub({ status: dead, ...stale }));
    assert.equal(s.pausedFrom, null, dead);
    assert.equal(s.pausedUntil, null, dead);
    assert.equal(s.active, false, dead);
  }
});

test('a live subscription keeps its pause window', () => {
  // The counterpart: pause_collection leaves the status on 'active', and those
  // must still derive a window or the pause does nothing at all.
  for (const alive of ['active', 'trialing', 'past_due']) {
    const s = subscriptionStateFromStripe(
      sub({
        status: alive,
        pause_collection: { behavior: 'void', resumes_at: unix('2026-12-12T00:00:00Z') },
        metadata: { [PAUSED_FROM_KEY]: '2026-10-12T00:00:00.000Z' },
      }),
    );
    assert.equal(s.pausedFrom, '2026-10-12T00:00:00.000Z', alive);
    assert.equal(s.pausedUntil, '2026-12-12T00:00:00.000Z', alive);
    assert.equal(s.active, false, alive);
  }
});
