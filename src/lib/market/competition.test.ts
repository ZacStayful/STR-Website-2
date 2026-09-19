import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitionBand, competitionIntensity, competitionLabelFor, competitionTone, MIN_RATED_REPORTS, saturationLevelFor, saturationBand, saturationMeaning, SATURATION_GUIDE, REVIEW_UNCOMPETITIVE, REVIEW_THRESHOLD } from './competition.ts';

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

// ─── Saturation (the review count on its own) ─────────────────────────

test('saturation bands split at 60 and 100', () => {
  assert.equal(saturationLevelFor(0), 'uncontested');
  assert.equal(saturationLevelFor(59), 'uncontested');
  assert.equal(saturationLevelFor(60), 'workable');
  assert.equal(saturationLevelFor(99), 'workable');
  assert.equal(saturationLevelFor(100), 'competitive');
  assert.equal(saturationLevelFor(1000), 'competitive');
});

test('saturationBand rounds the average and carries copy', () => {
  const b = saturationBand(72.4);
  assert.equal(b?.reviews, 72);
  assert.equal(b?.level, 'workable');
  assert.equal(b?.headline, 'Workable');
  assert.ok((b?.meaning.length ?? 0) > 20, 'meaning should be a usable sentence');
});

test('saturationBand returns null rather than guessing without data', () => {
  assert.equal(saturationBand(null), null);
  assert.equal(saturationBand(Number.NaN), null);
  assert.equal(saturationBand(-1), null);
});

test('the guide covers every level once, least crowded first', () => {
  assert.deepEqual(SATURATION_GUIDE.map((g) => g.level), ['uncontested', 'workable', 'competitive']);
  assert.deepEqual(SATURATION_GUIDE.map((g) => g.range), ['Under 60', '60–99', '100+']);
  // Every level in the guide must agree with the function that bands a number.
  for (const g of SATURATION_GUIDE) assert.equal(g.meaning, saturationMeaning(g.level));
});

test('the guide ranges line up with the thresholds, with no gap or overlap', () => {
  assert.equal(saturationLevelFor(REVIEW_UNCOMPETITIVE - 1), 'uncontested');
  assert.equal(saturationLevelFor(REVIEW_UNCOMPETITIVE), 'workable');
  assert.equal(saturationLevelFor(REVIEW_THRESHOLD - 1), 'workable');
  assert.equal(saturationLevelFor(REVIEW_THRESHOLD), 'competitive');
});

test('adding saturation did not move the explorer’s own competition bands', () => {
  // Guards the additive promise: these are the pre-existing rules and must
  // keep answering exactly as before.
  assert.equal(competitionLabelFor(4.9, 150), 'Competitive');
  assert.equal(competitionLabelFor(4.5, 150), 'Busy but beatable');
  assert.equal(competitionLabelFor(4.9, 50), 'Opportunity');
  assert.equal(competitionLabelFor(4.7, 50), 'Emerging');
  assert.equal(competitionLabelFor(4.2, 50), 'Weak');
  // A market can be 'Opportunity' on the paired read and still be workable
  // on the review count alone — the two answer different questions.
  assert.equal(competitionLabelFor(4.9, 80), 'Opportunity');
  assert.equal(saturationLevelFor(80), 'workable');
});
