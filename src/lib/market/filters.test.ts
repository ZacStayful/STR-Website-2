import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET_CHOICES, BUDGET_LABELS, budgetFilterOptions, inBudget, isBudget, hasBeds, passesConfidence } from './filters.ts';

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

test('Batch 22c: Under £100k and £100k–£200k are offered; the legacy Under £200k still reads but is never offered', () => {
  assert.deepEqual([...BUDGET_CHOICES], ['u100', '100-200', '200-350', '350-500', '500+']);
  assert.deepEqual(BUDGET_CHOICES.map((b) => BUDGET_LABELS[b]), ['Under £100k', '£100k–£200k', '£200k–£350k', '£350k–£500k', '£500k+']);
  assert.equal(BUDGET_LABELS.u200, 'Under £200k');
  assert.ok(isBudget('u100') && isBudget('100-200') && isBudget('u200') && !isBudget('u150'));
  assert.equal(inBudget(99_999, 'u100'), true);
  assert.equal(inBudget(100_000, 'u100'), false);
  assert.equal(inBudget(100_000, '100-200'), true);
  assert.equal(inBudget(199_999, '100-200'), true);
  assert.equal(inBudget(200_000, '100-200'), false);
  assert.equal(inBudget(null, 'u100'), false);
  assert.deepEqual(budgetFilterOptions('any'), ['any', 'u100', '100-200', '200-350', '350-500', '500+']);
  assert.deepEqual(budgetFilterOptions('u200'), ['any', 'u100', '100-200', '200-350', '350-500', '500+', 'u200'], 'an old link keeps its choice');
});
