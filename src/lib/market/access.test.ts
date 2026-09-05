import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketAccessState } from './access.ts';
import { FREE_RUNS } from '../access.ts';

const free = { plan: 'free' as const, reports_run: 0, stripe_subscription_id: null };
const user = { email: 'someone@example.com' };

test('no user → anon', () => {
  assert.equal(marketAccessState(null, free), 'anon');
  assert.equal(marketAccessState(undefined, null), 'anon');
});

test('user with no profile row → blocked', () => {
  assert.equal(marketAccessState(user, null), 'blocked');
});

test('free user with runs left → ok', () => {
  assert.equal(marketAccessState(user, { ...free, reports_run: FREE_RUNS - 1 }), 'ok');
});

test('free user with all runs used → blocked', () => {
  assert.equal(marketAccessState(user, { ...free, reports_run: FREE_RUNS }), 'blocked');
  assert.equal(marketAccessState(user, { ...free, reports_run: FREE_RUNS + 3 }), 'blocked');
});

test('lapsed subscriber → blocked even with runs left', () => {
  assert.equal(marketAccessState(user, { ...free, stripe_subscription_id: 'sub_1' }), 'blocked');
});

test('pro → ok', () => {
  assert.equal(marketAccessState(user, { plan: 'pro', reports_run: 99, stripe_subscription_id: 'sub_1' }), 'ok');
});

test('admin email → ok regardless of profile', () => {
  const admin = { email: 'zac@stayful.co.uk' };
  assert.equal(marketAccessState(admin, null), 'ok');
  assert.equal(marketAccessState(admin, { ...free, reports_run: FREE_RUNS, stripe_subscription_id: 'sub_x' }), 'ok');
});

test('does not mutate the profile', () => {
  const p = { ...free, reports_run: 2 };
  const before = JSON.stringify(p);
  marketAccessState(user, p);
  assert.equal(JSON.stringify(p), before);
});
