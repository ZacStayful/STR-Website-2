import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inBudget, hasBeds, passesConfidence } from './filters.ts';

test('budget brackets; null value fails any specific bracket', () => {
  assert.equal(inBudget(null, 'any'), true);
  assert.equal(inBudget(null, 'u200'), false);
  assert.equal(inBudget(199_999, 'u200'), true);
  assert.equal(inBudget(200_000, 'u200'), false);
  assert.equal(inBudget(200_000, '200-350'), true);
  assert.equal(inBudget(500_000, '500+'), true);
});

test('bedrooms', () => {
  assert.equal(hasBeds([1, 2], '2'), true);
  assert.equal(hasBeds([1, 2], '3'), false);
  assert.equal(hasBeds([5], '4+'), true);
});

test('confidence', () => {
  assert.equal(passesConfidence('early', 'building+'), false);
  assert.equal(passesConfidence('building', 'building+'), true);
  assert.equal(passesConfidence('building', 'confirmed'), false);
});
