import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankCompetition, competitionLabel, MIN_AREAS } from './competition.ts';

const area = (code: string, density: number | null, reviews: number | null, age: number | null = null) =>
  ({ code, density, reviews, age, sampleCount: 5 });

test('null for everyone until enough areas carry a signal', () => {
  const few = [area('A', 10, 20), area('B', 20, 30), area('C', null, null)];
  for (const v of rankCompetition(few).values()) assert.equal(v, null);
});

test('percentiles are monotonic and the blend follows the inputs', () => {
  const inputs = [area('A', 5, 10), area('B', 10, 20), area('C', 20, 40), area('D', 40, 80), area('E', 80, 160)];
  const r = rankCompetition(inputs);
  assert.equal(r.get('A')!.percentile, 0);
  assert.equal(r.get('E')!.percentile, 100);
  assert.equal(r.get('C')!.percentile, 50);
  assert.equal(r.get('A')!.label, 'Open');
  assert.equal(r.get('E')!.label, 'Saturated');
  assert.equal(r.get('A')!.areasRanked, MIN_AREAS);
});

test('a missing signal is dropped and renormalised; an area with nothing is null', () => {
  const inputs = [area('A', 5, null), area('B', 10, 20), area('C', 20, 40), area('D', 40, 80), area('E', 80, 160), area('Z', null, null)];
  const r = rankCompetition(inputs);
  const a = r.get('A')!;
  assert.equal(a.components.find((c) => c.key === 'reviews')!.percentile, null);
  assert.equal(a.percentile, 0); // density-only, lowest
  assert.equal(r.get('Z'), null);
});

test('ties share a mid rank', () => {
  const inputs = [area('A', 10, 1), area('B', 10, 2), area('C', 10, 3), area('D', 50, 4), area('E', 90, 5)];
  const r = rankCompetition(inputs);
  const dA = r.get('A')!.components[0].percentile;
  const dB = r.get('B')!.components[0].percentile;
  assert.equal(dA, dB);
});

test('labels by quartile', () => {
  assert.equal(competitionLabel(0), 'Open');
  assert.equal(competitionLabel(24), 'Open');
  assert.equal(competitionLabel(25), 'Moderate');
  assert.equal(competitionLabel(74), 'Busy');
  assert.equal(competitionLabel(75), 'Saturated');
});
