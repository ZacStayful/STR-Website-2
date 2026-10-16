import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeLabel, faceHintPence, hintLabel } from './format.ts';

const rates = { plan: 1, welcome: 1, topup: 1.3, adjustment: 1.3 };
const buckets = (b: Partial<{ planPence: number; welcomePence: number; topupPence: number; adjustmentPence: number }>) => ({ planPence: 0, welcomePence: 0, topupPence: 0, adjustmentPence: 0, ...b });

// Review R3 (R3-30): the hint is what will come off this member's balance, not the base setting.
test('a hint is shown as it will be charged: plan credit at the base, top-up credit at its rate', () => {
  assert.equal(faceHintPence(8, { buckets: buckets({ planPence: 5000 }), rates }), 8);
  assert.equal(faceHintPence(8, { buckets: buckets({ welcomePence: 2000 }), rates }), 8);
  assert.equal(faceHintPence(8, { buckets: buckets({ topupPence: 2500 }), rates }), 10.4);
  assert.equal(faceHintPence(1, { buckets: buckets({ adjustmentPence: 300 }), rates }), 1.3);
  assert.equal(faceHintPence(8, { buckets: buckets({ planPence: 5, topupPence: 2500 }), rates }), 10.4, 'mixed: the dearer rate');
  assert.equal(faceHintPence(8, { buckets: buckets({}), rates }), 8, 'nothing left: the base figure');
  assert.equal(faceHintPence(8, null), 8, 'no credit read yet: the base figure');
  assert.equal(hintLabel(faceHintPence(8, { buckets: buckets({ topupPence: 2500 }), rates })), 'about 10.4p');
  assert.equal(chargeLabel(10.4), '10.4p');
});
