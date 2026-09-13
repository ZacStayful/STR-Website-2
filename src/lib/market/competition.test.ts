import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitionBand, competitionIntensity, competitionLabelFor, competitionTone, MIN_RATED_REPORTS } from './competition.ts';

test('the five bands from rating and review count', () => {
  assert.equal(competitionLabelFor(4.9, 150), 'Competitive');
  assert.equal(competitionLabelFor(4.7, 150), 'Busy but beatable');
  assert.equal(competitionLabelFor(4.5, 150), 'Busy but beatable');
  assert.equal(competitionLabelFor(4.85, 40), 'Opportunity');
  assert.equal(competitionLabelFor(4.7, 40), 'Emerging');
  assert.equal(competitionLabelFor(4.5, 40), 'Weak');
});

test('boundaries sit exactly on 4.6, 4.8 and 100', () => {
  assert.equal(competitionLabelFor(4.8, 100), 'Competitive');
  assert.equal(competitionLabelFor(4.8, 99), 'Opportunity');
  assert.equal(competitionLabelFor(4.6, 99), 'Emerging');
  assert.equal(competitionLabelFor(4.59, 99), 'Weak');
  assert.equal(competitionLabelFor(4.79, 100), 'Busy but beatable');
});

test('a missing signal counts as its floor', () => {
  assert.equal(competitionLabelFor(null, 120), 'Busy but beatable');
  assert.equal(competitionLabelFor(4.9, null), 'Opportunity');
  assert.equal(competitionLabelFor(null, null), 'Weak');
});

test('null below the rated-report minimum or with no signals at all', () => {
  assert.equal(competitionBand({ rating: 4.9, reviews: 150, sampleCount: MIN_RATED_REPORTS - 1 }), null);
  assert.equal(competitionBand({ rating: null, reviews: null, sampleCount: 5 }), null);
  assert.ok(competitionBand({ rating: 4.9, reviews: 150, sampleCount: MIN_RATED_REPORTS }));
});

test('intensity never falls as reviews or rating rise, and clamps to 0–100', () => {
  assert.ok(competitionIntensity(4.8, 50) < competitionIntensity(4.8, 100));
  assert.ok(competitionIntensity(4.5, 100) < competitionIntensity(4.9, 100));
  assert.equal(competitionIntensity(4.0, 0), 0);
  assert.equal(competitionIntensity(5.0, 500), 100);
  assert.equal(competitionIntensity(4.8, 100), 55);
});

test('tone per label and an explanation that carries the figures', () => {
  assert.equal(competitionTone('Competitive'), 'info');
  assert.equal(competitionTone('Opportunity'), 'works');
  assert.equal(competitionTone('Weak'), 'no');
  assert.equal(competitionTone('Emerging'), 'tight');
  assert.equal(competitionTone('Busy but beatable'), 'tight');
  const band = competitionBand({ rating: 4.853, reviews: 62.4, sampleCount: 7 })!;
  assert.equal(band.label, 'Opportunity');
  assert.equal(band.rating, 4.85);
  assert.equal(band.reviews, 62);
  assert.match(band.explanation, /4\.85★ from 62 reviews/);
});
