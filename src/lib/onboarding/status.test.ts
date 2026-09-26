import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeDue, skipsFrom, MAX_WELCOME_SKIPS } from './status.ts';

test('due for a new owner with no goals and no skips', () => {
  assert.equal(welcomeDue({ hasGoals: false, skips: 0, teamRole: 'owner' }), true);
});

test('answering ends it for good, whatever the skip count', () => {
  assert.equal(welcomeDue({ hasGoals: true, skips: 0, teamRole: 'owner' }), false);
  assert.equal(welcomeDue({ hasGoals: true, skips: 99, teamRole: 'owner' }), false);
});

test('stops after the third skip', () => {
  assert.equal(MAX_WELCOME_SKIPS, 3);
  assert.equal(welcomeDue({ hasGoals: false, skips: 1, teamRole: 'owner' }), true);
  assert.equal(welcomeDue({ hasGoals: false, skips: 2, teamRole: 'owner' }), true);
  assert.equal(welcomeDue({ hasGoals: false, skips: 3, teamRole: 'owner' }), false);
  assert.equal(welcomeDue({ hasGoals: false, skips: 7, teamRole: 'owner' }), false);
});

test('team members never see it', () => {
  assert.equal(welcomeDue({ hasGoals: false, skips: 0, teamRole: 'member' }), false);
});

test('a stored skip count is read tolerantly', () => {
  assert.equal(skipsFrom(null), 0);
  assert.equal(skipsFrom(undefined), 0);
  assert.equal(skipsFrom('2'), 2);
  assert.equal(skipsFrom(2.9), 2);
  assert.equal(skipsFrom(-1), 0);
  assert.equal(skipsFrom('x'), 0);
  assert.equal(welcomeDue({ hasGoals: false, skips: Number.NaN, teamRole: 'owner' }), true);
});
