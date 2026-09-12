import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketAccessState } from './access.ts';

const user = { email: 'someone@example.com' };
const free = { id: 'u1', plan_code: null };

test('no user → anon', () => {
  assert.equal(marketAccessState(null, free), 'anon');
  assert.equal(marketAccessState(undefined, null), 'anon');
});

test('user with no profile row → blocked', () => {
  assert.equal(marketAccessState(user, null), 'blocked');
});

test('pay-as-you-go member (no plan) → ok; credit is checked per action, not here', () => {
  assert.equal(marketAccessState(user, free), 'ok');
});

test('subscriber → ok', () => {
  assert.equal(marketAccessState(user, { id: 'u2', plan_code: 'pro' }), 'ok');
});

test('admin email → ok regardless of profile', () => {
  const admin = { email: 'zac@stayful.co.uk' };
  assert.equal(marketAccessState(admin, null), 'ok');
});

test('does not mutate the profile', () => {
  const p = { ...free };
  const before = JSON.stringify(p);
  marketAccessState(user, p);
  assert.equal(JSON.stringify(p), before);
});
