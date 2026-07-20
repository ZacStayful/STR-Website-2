import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaConfidence } from './confidence.ts';

test('10+ samples is Confirmed', () => {
  assert.equal(areaConfidence(10).tier, 'confirmed');
  assert.equal(areaConfidence(25).tier, 'confirmed');
});

test('5–9 samples is Building', () => {
  assert.equal(areaConfidence(5).tier, 'building');
  assert.equal(areaConfidence(9).tier, 'building');
});

test('under 5 samples is Early', () => {
  assert.equal(areaConfidence(4).tier, 'early');
  assert.equal(areaConfidence(1).tier, 'early');
});

test('rank orders confirmed > building > early', () => {
  assert.ok(areaConfidence(12).rank > areaConfidence(6).rank);
  assert.ok(areaConfidence(6).rank > areaConfidence(2).rank);
});
