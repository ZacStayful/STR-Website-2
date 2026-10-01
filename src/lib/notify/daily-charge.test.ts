import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayChargeDue, freeTeasersFor } from './daily-charge.ts';

const base = { mode: 'per_day' as const, admin: false, teasers: 5, funded: true, mandatoryDone: true };

test('a funded profile with teasers is charged its day under per-day pricing', () => {
  assert.equal(dayChargeDue(base), true);
});

test('never before the new pricing date, never an admin, never a part without teasers', () => {
  assert.equal(dayChargeDue({ ...base, mode: 'per_pick' }), false);
  assert.equal(dayChargeDue({ ...base, admin: true }), false);
  assert.equal(dayChargeDue({ ...base, teasers: 0 }), false);
});

test('Batch 21 (Q2): a seat the payer could not fund goes uncharged', () => {
  assert.equal(dayChargeDue({ ...base, funded: false }), false);
});

test('Batch 21 (B49, Q16): a member who has not answered the mandatory questions is not charged', () => {
  assert.equal(dayChargeDue({ ...base, mandatoryDone: false }), false);
});

test('Batch 21 (Q2): the teasers are free only when no profile could be funded', () => {
  assert.equal(freeTeasersFor([{ funded: false }]), true);
  assert.equal(freeTeasersFor([{ funded: false }, { funded: false }]), true);
  assert.equal(freeTeasersFor([{ funded: true }, { funded: false }]), false, 'funded in part: the unfunded profile is left out and named');
  assert.equal(freeTeasersFor([]), false);
});
