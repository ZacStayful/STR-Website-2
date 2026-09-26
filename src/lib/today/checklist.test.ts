import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistVisible, inWindow, isStepKey, rewardEligibility, rewardLine, rewardRef, stepsDone, STEP_KEYS, type Evidence } from './checklist.ts';

const NOTHING: Evidence = { goals: false, keeps: 0, opened: false, reported: false, shared: false };
const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

test('five steps, in order, each ticked only by what was actually done', () => {
  assert.deepEqual(STEP_KEYS, ['goals', 'keep3', 'open', 'report', 'share']);
  assert.deepEqual(stepsDone(NOTHING), []);
  assert.deepEqual(stepsDone({ ...NOTHING, keeps: 2 }), [], 'two keeps is not three');
  assert.deepEqual(stepsDone({ ...NOTHING, keeps: 3 }), ['keep3']);
  assert.deepEqual(stepsDone({ goals: true, keeps: 5, opened: true, reported: true, shared: true }), STEP_KEYS);
  assert.deepEqual(stepsDone({ ...NOTHING, shared: true, goals: true }), ['goals', 'share']);
  assert.ok(isStepKey('keep3'));
  assert.ok(!isStepKey('keep'));
});

test('the checklist runs for the first seven days from sign-up', () => {
  assert.equal(inWindow(daysAgo(0), NOW), true);
  assert.equal(inWindow(daysAgo(6.9), NOW), true);
  assert.equal(inWindow(daysAgo(7), NOW), false, 'day eight: the offer has ended');
  assert.equal(inWindow(daysAgo(400), NOW), false);
  assert.equal(inWindow(null, NOW), false, 'an unknown sign-up date is never inside');
  assert.equal(inWindow('garbage', NOW), false);
});

test('only accounts the welcome check cleared are paid; team members never are', () => {
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: daysAgo(1), welcomeWithheldReason: null, teamMember: false }), { kind: 'eligible' });
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: daysAgo(1), welcomeWithheldReason: 'disposable_email', teamMember: false }), { kind: 'never', reason: 'welcome_withheld' });
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: daysAgo(1), welcomeWithheldReason: 'mobile_already_used', teamMember: false }), { kind: 'never', reason: 'welcome_withheld' });
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: daysAgo(1), welcomeWithheldReason: 'team_member', teamMember: false }), { kind: 'never', reason: 'team_member' });
  // Joined a team after their own welcome credit was granted.
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: daysAgo(3), welcomeWithheldReason: null, teamMember: true }), { kind: 'never', reason: 'team_member' });
  // Welcome check not run yet (an open team invite): wait, never guess.
  assert.deepEqual(rewardEligibility({ welcomeCheckedAt: null, welcomeWithheldReason: null, teamMember: false }), { kind: 'pending' });
});

test('one grant reference per account per step', () => {
  assert.equal(rewardRef('open', 'u1'), 'checklist:open:u1');
  assert.notEqual(rewardRef('open', 'u1'), rewardRef('open', 'u2'));
  assert.notEqual(rewardRef('open', 'u1'), rewardRef('share', 'u1'));
  assert.ok(!rewardRef('goals', 'u1').startsWith('welcome:'), 'never collides with the welcome grant itself');
});

test('the confirmation says what landed and how far along they are', () => {
  assert.equal(rewardLine(1, 2), '+£1 credit — 2 of 5 done');
  assert.equal(rewardLine(2, 2), '+£2 credit — 2 of 5 done');
  assert.equal(rewardLine(0, 3), null);
});

test('the card shows until everything is done, says so once, then disappears for good', () => {
  const fresh = daysAgo(2);
  assert.equal(checklistVisible({ createdAt: fresh, doneCount: 0, newlyPaid: 0, now: NOW }), true);
  assert.equal(checklistVisible({ createdAt: fresh, doneCount: 4, newlyPaid: 0, now: NOW }), true);
  assert.equal(checklistVisible({ createdAt: fresh, doneCount: 5, newlyPaid: 1, now: NOW }), true, 'the last step’s £1 is still shown');
  assert.equal(checklistVisible({ createdAt: fresh, doneCount: 5, newlyPaid: 0, now: NOW }), false);
  assert.equal(checklistVisible({ createdAt: daysAgo(8), doneCount: 1, newlyPaid: 0, now: NOW }), false, 'gone after the first week');
});
