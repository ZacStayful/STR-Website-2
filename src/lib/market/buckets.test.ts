import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketIndex, bucketLabels, buildBuckets, quantileThresholds, spreadPalette } from './buckets.ts';

test('four bands from the rounded quartiles, every band non-empty', () => {
  const values = [10, 22, 27, 31, 35, 44, 52, 60, 68, 75, 81, 90];
  const th = quantileThresholds(values, 5);
  assert.deepEqual(th, [30, 50, 75]);
  const counts = [0, 0, 0, 0];
  for (const v of values) counts[bucketIndex(v, th)] += 1;
  assert.ok(counts.every((c) => c > 0), `empty band in ${counts}`);
  assert.deepEqual(bucketLabels(th, String), ['< 30', '30 – 50', '50 – 75', '≥ 75']);
});

test('duplicate quartiles collapse instead of producing empty bands', () => {
  // q25, q50 and q75 all round to 20 → one threshold, two bands
  const th = quantileThresholds([10, 20, 20, 20, 21, 40], 10);
  assert.deepEqual(th, [20]);
  assert.deepEqual(bucketLabels(th, String), ['< 20', '≥ 20']);
});

test('thresholds never sit outside the data', () => {
  assert.deepEqual(quantileThresholds([12, 13, 14], 10), []); // all round to 10 (≤ min) — one band
  assert.deepEqual(quantileThresholds([12, 26], 10), []); // q25/q50 → 10 (≤ min), q75 → 30 (> max)
  assert.deepEqual(quantileThresholds([12, 26], 1), [26]); // two bands: < 26, ≥ 26
});

test('one value, no values, identical values → a single band', () => {
  assert.deepEqual(buildBuckets([], 5, String), { thresholds: [], labels: ['All areas'] });
  assert.deepEqual(buildBuckets([42], 5, String).labels, ['All areas']);
  assert.deepEqual(buildBuckets([7, 7, 7], 1, String).labels, ['All areas']);
});

test('bucketIndex and formatting', () => {
  const th = [1000, 2000];
  assert.equal(bucketIndex(999, th), 0);
  assert.equal(bucketIndex(1000, th), 1);
  assert.equal(bucketIndex(5000, th), 2);
  assert.deepEqual(bucketLabels(th, (v) => `£${v / 1000}k`), ['< £1k', '£1k – £2k', '≥ £2k']);
});

test('spreadPalette keeps the contrast on short scales', () => {
  const p = ['a', 'b', 'c', 'd'];
  assert.deepEqual(spreadPalette(p, 4), p);
  assert.deepEqual(spreadPalette(p, 3), ['a', 'c', 'd']);
  assert.deepEqual(spreadPalette(p, 2), ['a', 'd']);
  assert.deepEqual(spreadPalette(p, 1), ['d']);
  assert.deepEqual(spreadPalette(p, 0), []);
});
