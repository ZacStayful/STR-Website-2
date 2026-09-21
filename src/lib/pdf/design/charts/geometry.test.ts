import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcPath, semiArcPath, needlePath, gaugeAngle, scaleLinear, padDomain,
  niceCeil, bandWidths, mergeRuns, paybackMonths, median, clamp, safe,
} from './geometry.ts';

// A NaN in an SVG coordinate makes react-pdf render a blank page or throw, so
// every one of these guards exists to keep a degenerate analysis renderable.

test('an arc is undefined at both extremes', () => {
  // Zero-length, and full-circle (identical endpoints) — callers draw a plain
  // <Circle> for 100% instead.
  assert.equal(arcPath(50, 50, 40, 0), null);
  assert.equal(arcPath(50, 50, 40, 1), null);
  assert.equal(arcPath(50, 50, 40, Number.NaN), null);
});

test('an arc starts at twelve o\'clock and sweeps clockwise', () => {
  const quarter = arcPath(50, 50, 40, 0.25);
  assert.ok(quarter);
  // Starts at top centre (50, 10), ends at the right (90, 50).
  assert.match(quarter as string, /^M 50 10 A 40 40 0 0 1 90 50$/);
});

test('the large-arc flag flips past the halfway mark', () => {
  assert.match(arcPath(50, 50, 40, 0.25) as string, / 0 1 /);
  assert.match(arcPath(50, 50, 40, 0.75) as string, / 1 1 /);
});

test('the gauge spans the top half, left to right', () => {
  assert.equal(gaugeAngle(0), Math.PI);
  assert.equal(gaugeAngle(1), 2 * Math.PI);
  assert.equal(gaugeAngle(0.5), 1.5 * Math.PI);
  // Out-of-range scores are clamped rather than swinging the needle off-dial.
  assert.equal(gaugeAngle(-3), Math.PI);
  assert.equal(gaugeAngle(99), 2 * Math.PI);
  assert.equal(semiArcPath(50, 50, 40, 0.5, 0.5), null);
});

test('the needle points straight up at the midpoint', () => {
  const d = needlePath(50, 50, 40, 0.5);
  // Tip at (50, 50 - 32).
  assert.match(d, /^M 50 18 /);
  assert.ok(d.endsWith(' Z'));
});

test('a zero-width domain collapses to the midpoint instead of dividing by zero', () => {
  // Every comparable at an identical nightly rate.
  const s = scaleLinear(150, 150, 0, 200);
  assert.equal(s(150), 100);
  assert.ok(Number.isFinite(s(999)));
  const ok = scaleLinear(0, 100, 0, 200);
  assert.equal(ok(50), 100);
  assert.ok(Number.isFinite(ok(Number.NaN)));
});

test('padDomain never returns a zero-width range', () => {
  const [lo, hi] = padDomain(100, 100);
  assert.ok(hi > lo);
  const [lo2, hi2] = padDomain(0, 0);
  assert.ok(hi2 > lo2);
});

test('axis maxima round to friendly numbers', () => {
  assert.equal(niceCeil(1870), 2000);
  assert.equal(niceCeil(1000), 1000);
  assert.equal(niceCeil(1200), 2000);
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(-5), 1);
  assert.equal(niceCeil(Number.NaN), 1);
});

test('band widths fill the track exactly and never overflow it', () => {
  const w = bandWidths([50, 30, 20], 100, 300);
  assert.deepEqual(w, [150, 90, 60]);
  assert.equal(w.reduce((a, b) => a + b, 0), 300);
  // A zero scale yields zero-width bands rather than NaN.
  assert.deepEqual(bandWidths([1, 2], 0, 300), [0, 0]);
  // A value beyond the scale is clamped to the track.
  assert.deepEqual(bandWidths([200], 100, 300), [300]);
});

test('runs of dark modules merge into rectangles', () => {
  assert.deepEqual(mergeRuns([true, true, false, true]), [[0, 2], [3, 1]]);
  assert.deepEqual(mergeRuns([false, false]), []);
  assert.deepEqual(mergeRuns([true, true, true]), [[0, 3]]);
  assert.deepEqual(mergeRuns([]), []);
});

test('payback says nothing rather than "Infinity months"', () => {
  assert.equal(paybackMonths(12000, 1000), 12);
  assert.equal(paybackMonths(3110, 771), 5);
  assert.equal(paybackMonths(0, 500), 0);
  // No extra income to recover the cost from.
  assert.equal(paybackMonths(12000, 0), null);
  assert.equal(paybackMonths(12000, -50), null);
});

test('median handles even, odd and empty sets', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([Number.NaN]), null);
});

test('clamp and safe absorb the rubbish that reaches a chart', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(Number.NaN, 0, 1), 0);
  assert.equal(safe(undefined, 7), 7);
  assert.equal(safe(Number.POSITIVE_INFINITY, 7), 7);
  assert.equal(safe(3), 3);
});
