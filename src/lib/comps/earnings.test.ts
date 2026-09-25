import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annualEarningsRange,
  bandPositions,
  beatTargets,
  earningsRangeOf,
  estimatePosition,
  monthlyEarningsRange,
  percentileRank,
  positionPhrase,
  quantile,
  readEarningsRange,
  topQuarterThreshold,
} from './earnings.ts';
import { monthIndex } from './months.ts';

test('quantile interpolates (type 7) and drops non-finite values', () => {
  assert.equal(quantile([10, 20, 30, 40], 0.75), 32.5);
  assert.equal(quantile([40, 10, 30, 20], 0.5), 25);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([10, Number.NaN, 20], 0.5), 15);
});

test('percentileRank inverts quantile', () => {
  const v = [10, 20, 30, 40, 50];
  for (const q of [0.1, 0.25, 0.5, 0.8]) assert.ok(Math.abs(percentileRank(v, quantile(v, q)!)! - q) < 1e-9);
  assert.equal(percentileRank(v, 5), 0);
  assert.equal(percentileRank(v, 99), 1);
  assert.equal(percentileRank([10, 20, 20, 20, 30], 20), 0.5);
});

test('annual range thresholds', () => {
  assert.equal(annualEarningsRange([1, 2, 3, 4, 5]), null);
  const six = annualEarningsRange([10, 20, 30, 40, 50, 60])!;
  assert.equal(six.p90, null);
  assert.equal(six.n, 6);
  const ten = annualEarningsRange([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 0])!;
  assert.equal(ten.n, 10);
  assert.ok(ten.p25 <= ten.p50 && ten.p50 <= ten.p75 && ten.p75 <= ten.p90!);
});

test('monthly band: gaps, scale and a window across the year boundary', () => {
  const comps = Array.from({ length: 6 }, (_, k) => ({
    revenue: { '2025-01': 999, '2026-01': 100 + k, '2025-12': 200 + k, '2025-06': null, '2025-07': 300 },
    scale: 2,
  }));
  // Six filled months are needed, so pad with five more calendar months.
  for (const c of comps) Object.assign(c.revenue, { '2025-02': 1, '2025-03': 1, '2025-04': 1, '2025-05': 1 });
  const r = monthlyEarningsRange(comps, { end: monthIndex('2026-01')!, months: 12 })!;
  assert.equal(r.to, '2026-01');
  // January comes from 2026-01 (doubled), not 2025-01.
  assert.equal(r.p50[0], Math.round(quantile([100, 101, 102, 103, 104, 105], 0.5)! * 2));
  assert.equal(r.p50[5], null); // June: all null
  assert.equal(r.n[11], 6);
  assert.equal(monthlyEarningsRange(comps.slice(0, 4), { end: monthIndex('2026-01')!, months: 12 }), null);
});

test('earningsRangeOf: stored wins, malformed falls back to derived, old reports derive the annual range', () => {
  const comparables = [10, 20, 30, 40, 50, 60].map((annualRevenue) => ({ annualRevenue }));
  const stored = { basis: 'comparables', annual: { p25: 1, p50: 2, p75: 3, p90: null, n: 6 }, monthly: null };
  assert.equal(earningsRangeOf({ earningsRange: stored, comparables }).annual!.p50, 2);
  assert.equal(earningsRangeOf({ earningsRange: { annual: { p25: 'x' } }, comparables }).annual!.p50, 35);
  const old = earningsRangeOf({ comparables });
  assert.equal(old.annual!.p50, 35);
  assert.equal(old.monthly, null);
  assert.equal(readEarningsRange({ annual: { p25: 5, p50: 3, p75: 4, n: 6 } }), null);
});

test('position phrase and ordinals', () => {
  assert.equal(positionPhrase(0.05), 'below most similar listings');
  assert.equal(positionPhrase(0.95), 'above most similar listings');
  assert.equal(positionPhrase(0.6), 'about the 60th percentile');
  assert.equal(positionPhrase(0.21), 'about the 20th percentile');
  const revs = [10, 20, 30, 40, 50, 60];
  assert.equal(estimatePosition(revs, 35)!.percentile, 50);
  assert.equal(estimatePosition(revs.slice(0, 5), 35), null);
});

test('beat targets are P75 per metric', () => {
  assert.equal(beatTargets([]), null);
  const one = beatTargets([{ averageDailyRate: 100, occupancyRate: 0.7, annualRevenue: 20000 }])!;
  assert.deepEqual(one, { nightly: 100, occupancy: 0.7, revenue: 20000 });
  const comps = Array.from({ length: 12 }, (_, k) => ({ averageDailyRate: 100 + k, occupancyRate: 0.5 + k / 100, annualRevenue: 20000 + k * 1000 }));
  const b = beatTargets(comps)!;
  assert.equal(b.revenue, Math.round(quantile(comps.map((c) => c.annualRevenue), 0.75)!));
  assert.equal(topQuarterThreshold(comps.map((c) => c.annualRevenue)), quantile(comps.map((c) => c.annualRevenue), 0.75));
});

test('band positions never go NaN', () => {
  const flat = bandPositions({ p25: 5, p50: 5, p75: 5, p90: 5, n: 10 }, 5);
  for (const v of Object.values(flat)) if (v !== null) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  const p = bandPositions({ p25: 10, p50: 20, p75: 30, p90: null, n: 6 }, 50);
  assert.ok(p.p25 < p.p50 && p.p50 < p.p75 && p.p75 < p.estimate);
});
