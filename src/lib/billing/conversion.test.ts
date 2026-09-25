import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONVERSION_WINDOW_DAYS, conversionFunnel, type FirstPayment, type Signup } from './conversion.ts';

const NOW = new Date('2027-01-15T12:00:00.000Z');

/** A signup `days` before NOW. */
function signup(userId: string, daysAgo: number): Signup {
  return { userId, createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() };
}

/** A payment `afterDays` after that member signed up. */
function paid(userId: string, signedUpDaysAgo: number, afterDays: number, route: 'topup' | 'plan' = 'topup'): FirstPayment {
  const signedUp = NOW.getTime() - signedUpDaysAgo * 86_400_000;
  return { userId, at: new Date(signedUp + afterDays * 86_400_000).toISOString(), route };
}

test('the window is sixty days', () => {
  assert.equal(CONVERSION_WINDOW_DAYS, 60);
});

test('day 59 converts, day 61 is an anomaly', () => {
  const f = conversionFunnel(
    [signup('early', 90), signup('late', 90)],
    [paid('early', 90, 59), paid('late', 90, 61)],
    NOW,
  );
  assert.equal(f.converted, 1);
  assert.equal(f.anomalies, 1);
  assert.equal(f.members.find((m) => m.userId === 'early')!.outcome, 'converted');
  assert.equal(f.members.find((m) => m.userId === 'late')!.outcome, 'anomaly');
});

test('day 60 exactly still counts as converted', () => {
  const f = conversionFunnel([signup('u', 90)], [paid('u', 90, 60)], NOW);
  assert.equal(f.converted, 1);
  assert.equal(f.anomalies, 0);
});

test('an anomaly is kept out of the day statistics entirely', () => {
  const f = conversionFunnel(
    [signup('quick', 90), signup('late', 90)],
    [paid('quick', 90, 10), paid('late', 90, 80)],
    NOW,
  );
  assert.equal(f.medianDaysToConvert, 10, 'the 80-day conversion must not drag the median');
  assert.equal(f.meanDaysToConvert, 10);
  assert.equal(f.buckets.reduce((n, b) => n + b.members, 0), 1);
});

test('past sixty days without paying is discarded, not left pending', () => {
  const f = conversionFunnel([signup('stale', 61), signup('fresh', 59)], [], NOW);
  assert.equal(f.discarded, 1);
  assert.equal(f.pending, 1);
  assert.equal(f.members.find((m) => m.userId === 'stale')!.outcome, 'discarded');
  assert.equal(f.members.find((m) => m.userId === 'fresh')!.outcome, 'pending');
});

test('the settled rate is over members whose window is up, so it does not drift', () => {
  // One converted, one discarded, and three still inside the window that must
  // not dilute the rate.
  const f = conversionFunnel(
    [signup('won', 90), signup('lost', 90), signup('p1', 3), signup('p2', 3), signup('p3', 3)],
    [paid('won', 90, 20)],
    NOW,
  );
  assert.equal(f.settled, 2);
  assert.equal(f.settledPct, 50);
  assert.equal(f.pending, 3);
});

test('no settled members yet means no rate rather than zero', () => {
  const f = conversionFunnel([signup('u', 5)], [], NOW);
  assert.equal(f.settledPct, null);
  assert.equal(f.medianDaysToConvert, null);
});

test('time is to the FIRST payment when a member paid more than once', () => {
  const f = conversionFunnel(
    [signup('u', 90)],
    [paid('u', 90, 40), paid('u', 90, 12), paid('u', 90, 55)],
    NOW,
  );
  assert.equal(f.members[0].daysToConvert, 12);
});

test('going straight onto a subscription counts as converting', () => {
  const f = conversionFunnel(
    [signup('a', 90), signup('b', 90)],
    [paid('a', 90, 5, 'topup'), paid('b', 90, 5, 'plan')],
    NOW,
  );
  assert.equal(f.converted, 2);
  assert.deepEqual(f.byRoute, [
    { route: 'topup', members: 1 },
    { route: 'plan', members: 1 },
  ]);
});

test('conversions land in the right day buckets', () => {
  const f = conversionFunnel(
    [signup('a', 90), signup('b', 90), signup('c', 90), signup('d', 90)],
    [paid('a', 90, 2), paid('b', 90, 11), paid('c', 90, 25), paid('d', 90, 45)],
    NOW,
  );
  assert.deepEqual(
    f.buckets.map((b) => [b.key, b.members]),
    [['0-7', 1], ['8-14', 1], ['15-30', 1], ['31-60', 1]],
  );
  assert.equal(f.medianDaysToConvert, 18);
});

test('no signups at all is empty rather than a divide by zero', () => {
  const f = conversionFunnel([], [], NOW);
  assert.equal(f.converted, 0);
  assert.equal(f.settledPct, null);
  assert.equal(f.members.length, 0);
});
