import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insufficientCreditPayload, shadowModeAllows } from './http.ts';

test('Batch 21 (B27): a negative balance is shown as £0, and the shortfall is the whole price', () => {
  const p = insufficientCreditPayload({ requiredPence: 400, availablePence: -1320 }, 'full_analysis');
  assert.equal(p.availablePence, 0);
  assert.equal(p.shortfallPence, 400);
  assert.equal(p.error, "You're out of credit.");
});

test('a positive balance passes through and the shortfall is the difference', () => {
  const p = insufficientCreditPayload({ requiredPence: 400, availablePence: 150 }, 'full_analysis');
  assert.equal(p.availablePence, 150);
  assert.equal(p.shortfallPence, 250);
  assert.equal(p.error, "You don't have enough credit for this.");
});

test('Batch 21 (B2): shadow mode lets a member who was given the welcome credit carry on, and nobody else', () => {
  assert.equal(shadowModeAllows({ welcomeGranted: true, enforcing: false }), true);
  assert.equal(shadowModeAllows({ welcomeGranted: false, enforcing: false }), false, 'a pack-era or withheld account is held to its balance');
  assert.equal(shadowModeAllows({ welcomeGranted: true, enforcing: true }), false);
  assert.equal(shadowModeAllows({ welcomeGranted: true, requireCredit: true, enforcing: false }), false);
});
