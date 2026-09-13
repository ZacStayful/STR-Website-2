import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaSeasonality, coefficientOfVariation, seasonalityLabel, seasonalityScore, MIN_SEASONALITY_REPORTS } from './seasonality.ts';

const flat = Array.from({ length: 12 }, () => 1000);

test('a flat year scores 100 and is Steady', () => {
  const s = areaSeasonality({ sample_count: 5, monthly: flat })!;
  assert.equal(s.score, 100);
  assert.equal(s.label, 'Steady');
  assert.equal(s.cv, 0);
  assert.ok(Math.abs(s.profile.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(s.profile.every((v) => Math.abs(v - 1 / 12) < 1e-9));
});

test('a known vector gives the hand-computed cv, peak and low', () => {
  // ten months of 500, two of 1500: mean 666.67, sd 372.68 → cv 0.559
  const monthly = [500, 500, 500, 500, 500, 500, 1500, 1500, 500, 500, 500, 500];
  const cv = coefficientOfVariation(monthly)!;
  assert.ok(Math.abs(cv - 0.559) < 0.001);
  const s = areaSeasonality({ sample_count: 3, monthly })!;
  assert.equal(s.score, seasonalityScore(cv));
  assert.equal(s.label, 'Highly seasonal');
  assert.equal(s.peakMonth, 6);
  assert.equal(s.lowMonth, 0);
  assert.match(s.explanation, /Peaks in Jul/);
  assert.match(s.explanation, /quietest in Jan/);
});

test('thresholds', () => {
  assert.equal(seasonalityScore(0.15), 75);
  assert.equal(seasonalityLabel(75), 'Steady');
  assert.equal(seasonalityScore(0.35), 42);
  assert.equal(seasonalityLabel(42), 'Seasonal');
  assert.equal(seasonalityScore(0.6), 0);
  assert.equal(seasonalityLabel(0), 'Highly seasonal');
  assert.equal(seasonalityScore(2), 0);
});

test('null without enough reports, without twelve months, or with no revenue', () => {
  assert.equal(areaSeasonality({ sample_count: MIN_SEASONALITY_REPORTS - 1, monthly: flat }), null);
  assert.equal(areaSeasonality({ sample_count: 5, monthly: flat.slice(0, 11) }), null);
  assert.equal(areaSeasonality({ sample_count: 5, monthly: flat.map(() => 0) }), null);
  assert.equal(areaSeasonality(null), null);
  assert.equal(areaSeasonality(undefined), null);
});
