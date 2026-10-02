import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditLine, profileCreditDecision, profileCreditRef, realAnswersNeeded, PROFILE_CREDIT_KIND } from './credit.ts';

const done = (real: number, questions = 24, mandatory = 3) => ({ complete: true, questions: Array.from({ length: questions }, (_, i) => `q${i}`) as never, mandatory: Array.from({ length: mandatory }, (_, i) => `m${i}`) as never, real });

test('the reference is one per account and the kind spends at face value', () => {
  assert.equal(profileCreditRef('u1'), 'profile_complete:u1');
  assert.equal(PROFILE_CREDIT_KIND, 'welcome');
});

test('the real answers needed are the mandatory ones plus the share of the rest', () => {
  assert.equal(realAnswersNeeded({ questions: 24, mandatory: 3, minRealPct: 75 }), 3 + Math.ceil(21 * 0.75));
  assert.equal(realAnswersNeeded({ questions: 24, mandatory: 3, minRealPct: 0 }), 3);
  assert.equal(realAnswersNeeded({ questions: 24, mandatory: 3, minRealPct: 100 }), 24);
  assert.equal(realAnswersNeeded({ questions: 3, mandatory: 3, minRealPct: 75 }), 3);
  assert.equal(realAnswersNeeded({ questions: 10, mandatory: 3, minRealPct: 150 }), 10, 'capped at every question');
});

test('paid once the profile is complete with enough real answers and the welcome check cleared it', () => {
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'eligible' }, progress: done(24), minRealPct: 75 }), { kind: 'pay' });
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'eligible' }, progress: done(19), minRealPct: 75 }), { kind: 'pay' });
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'eligible' }, progress: done(18), minRealPct: 75 }), { kind: 'wait', reason: 'not_enough_real', needed: 1 });
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'eligible' }, progress: done(3), minRealPct: 75 }), { kind: 'wait', reason: 'not_enough_real', needed: 16 }, 'every question "Not sure" earns nothing');
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'eligible' }, progress: { ...done(24), complete: false }, minRealPct: 75 }), { kind: 'wait', reason: 'not_enough_real', needed: 1 });
});

test('the welcome check’s verdict is final: withheld and team members are never paid, pending waits', () => {
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'never', reason: 'team_member' }, progress: done(24), minRealPct: 75 }), { kind: 'never', reason: 'team_member' });
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'never', reason: 'welcome_withheld' }, progress: done(24), minRealPct: 75 }), { kind: 'never', reason: 'welcome_withheld' });
  assert.deepEqual(profileCreditDecision({ eligibility: { kind: 'pending' }, progress: done(24), minRealPct: 75 }), { kind: 'wait', reason: 'welcome_pending', needed: 0 });
});

test('the line says what happened', () => {
  assert.equal(creditLine({ paid: true, decision: null, pence: 500 }), '£5 of credit is on your account for completing your profile.');
  assert.equal(creditLine({ paid: false, decision: null, pence: 500 }), 'Complete your profile for £5 of credit.');
  assert.match(creditLine({ paid: false, decision: { kind: 'wait', reason: 'not_enough_real', needed: 2 }, pence: 500 }), /Answer 2 more questions/);
  assert.match(creditLine({ paid: false, decision: { kind: 'wait', reason: 'not_enough_real', needed: 1 }, pence: 500 }), /Answer 1 more question with/);
  assert.match(creditLine({ paid: false, decision: { kind: 'never', reason: 'team_member' }, pence: 500 }), /team/);
  assert.match(creditLine({ paid: false, decision: { kind: 'wait', reason: 'welcome_pending', needed: 0 }, pence: 750 }), /£7\.50/);
});

test('Batch 22d: paid before this completion (Start again, a blank profile): says so and never offers it again', () => {
  const again = creditLine({ paid: true, already: true, decision: null, pence: 500 });
  assert.equal(again, 'You’ve already had your £5 for completing your profile, so there’s none for answering again.');
  assert.equal(creditLine({ paid: true, already: true, decision: { kind: 'pay' }, pence: 500 }), again, 'whatever the decision, a paid account is never offered it');
  assert.equal(creditLine({ paid: true, decision: null, pence: 500 }), '£5 of credit is on your account for completing your profile.', 'a first completion reads as before');
  assert.equal(creditLine({ paid: false, already: true, decision: null, pence: 500 }), 'Complete your profile for £5 of credit.', '`already` means nothing until it has been paid');
});
