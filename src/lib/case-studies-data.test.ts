import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_STUDIES,
  accuracySummary,
  formatMetric,
  formatVariance,
  variance,
} from './case-studies-data.ts';

// The landing page and /methodology both state two claims about this sample
// in prose. If an edit to CASE_STUDIES ever falsifies one of them, that is a
// published inaccuracy on a page whose whole argument is accuracy — so the
// claims are asserted here rather than trusted.

test('every case study carries both metrics and a real PDF path', () => {
  assert.equal(CASE_STUDIES.length, 6);
  for (const s of CASE_STUDIES) {
    assert.ok(s.metrics.ownerNet.forecast > 0, `${s.id} forecast`);
    assert.ok(s.metrics.ownerNet.actual > 0, `${s.id} actual`);
    assert.ok(s.metrics.occupancy.forecast > 0 && s.metrics.occupancy.forecast <= 100);
    assert.ok(s.metrics.occupancy.actual > 0 && s.metrics.occupancy.actual <= 100);
    assert.match(s.pdf, /^\/assets\/case-studies\/.+\.pdf$/, `${s.id} pdf path`);
  }
});

test('CLAIM: owner net came in above forecast on all six', () => {
  const [ownerNet] = accuracySummary(CASE_STUDIES, ['ownerNet']);
  assert.equal(ownerNet.aboveForecast, 6);
  assert.equal(ownerNet.n, 6);
});

test('CLAIM: occupancy landed within five points every time', () => {
  for (const s of CASE_STUDIES) {
    const v = Math.abs(variance('occupancy', s.metrics.occupancy));
    assert.ok(v < 5, `${s.id} occupancy missed by ${v.toFixed(1)} points`);
  }
});

test('accuracySummary derives the figures the page prints', () => {
  const [ownerNet, occupancy] = accuracySummary();

  // York +12.24%, Leeds +11.69%, Lincoln +12.12%,
  // Edinburgh +27.63%, Manchester +10.78%, Salisbury +13.86%
  assert.ok(Math.abs(ownerNet.medianVariance - 0.12182) < 0.0005);
  assert.ok(Math.abs(ownerNet.worstVariance - 0.27630) < 0.0005);
  assert.ok(ownerNet.meanVariance > 0);

  // Five of six came in under forecast on occupancy; Edinburgh is the outlier.
  assert.equal(occupancy.aboveForecast, 1);
  assert.ok(Math.abs(occupancy.worstVariance - -4.9) < 0.001);
});

test('occupancy variance is in points, money variance is a fraction', () => {
  const york = CASE_STUDIES[0];
  assert.equal(formatVariance('occupancy', york.metrics.occupancy), '−4.1 pts');
  assert.equal(formatVariance('ownerNet', york.metrics.ownerNet), '+12.2%');
});

test('formatMetric renders money and occupancy in the page style', () => {
  assert.equal(formatMetric('ownerNet', 30940), '£30,940');
  assert.equal(formatMetric('occupancy', 78), '78%');
  assert.equal(formatMetric('occupancy', 73.9), '73.9%');
});
