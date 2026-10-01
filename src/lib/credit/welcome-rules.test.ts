import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeOutcome, withheldReason, type WelcomeFacts } from './welcome-rules.ts';

const clean: WelcomeFacts = { teamMember: false, openInvite: false, disposableEmail: false, mobileAlreadyUsed: false, cutoverKnown: true, packAccount: false, hasPack: false };

test('the welcome decision, in order (Batch 21, G3)', () => {
  assert.equal(welcomeOutcome(clean), 'grant');
  assert.equal(welcomeOutcome({ ...clean, teamMember: true, disposableEmail: true }), 'team_member');
  assert.equal(welcomeOutcome({ ...clean, openInvite: true, disposableEmail: true }), 'open_invite');
  assert.equal(welcomeOutcome({ ...clean, disposableEmail: true, mobileAlreadyUsed: true }), 'disposable_email');
  assert.equal(welcomeOutcome({ ...clean, mobileAlreadyUsed: true, cutoverKnown: false }), 'mobile_already_used');
  // The abuse checks come before the cutover: a withheld account is stamped even when the setting cannot be read.
  assert.equal(welcomeOutcome({ ...clean, cutoverKnown: false }), 'postpone');
  assert.equal(welcomeOutcome({ ...clean, cutoverKnown: false, packAccount: true }), 'postpone');
  assert.equal(welcomeOutcome({ ...clean, packAccount: true }), 'pack');
  // B45: a pack bought or being paid for is never topped with the £20 as well, whatever the cutover says now.
  assert.equal(welcomeOutcome({ ...clean, hasPack: true }), 'pack');
});

test('what gets stamped as withheld', () => {
  assert.equal(withheldReason('team_member'), 'team_member');
  assert.equal(withheldReason('disposable_email'), 'disposable_email');
  assert.equal(withheldReason('mobile_already_used'), 'mobile_already_used');
  assert.equal(withheldReason('open_invite'), null);
  assert.equal(withheldReason('postpone'), null);
  assert.equal(withheldReason('pack'), null);
  assert.equal(withheldReason('grant'), null);
});
