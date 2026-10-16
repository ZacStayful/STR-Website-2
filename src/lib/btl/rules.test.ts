import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkFor, benchmarkWhere, type BenchmarkDeal } from './benchmark.ts';
import { btlStandout, floorsPass, passesFor, type BtlJudged } from './rules.ts';
import type { Benchmark } from './benchmark.ts';

// The worked examples' benchmarks (Batch 28 plan, live data 16 Oct 2026).
function bm(roiMedianPct: number, roiP40Pct: number, growthMedianPct: number | null, growthP40Pct: number | null, over: Partial<Benchmark> = {}): Benchmark {
  return { band: '25k_50k', step: 'national', radiusMiles: null, count: 26, steps: [], roiMedianPct, roiP40Pct, growthMedianPct, growthP40Pct, thin: true, none: false, ...over };
}
const BAND_25_50 = bm(10.2, 9.9, 2.37, 2.33);
const BAND_50_100 = bm(0.8, 0.2, 1.83, 1.37, { band: '50k_100k', count: 157, thin: false });

const B44: BtlJudged = { roiPct: { low: 6.7, mid: 9.7, high: 12 }, growthPct: { low: 2.6, mid: 3.9, high: 5.21 }, cashflowLow: 316, rentTestPass: true };
const CH41: BtlJudged = { roiPct: { low: 3.1, mid: 7.9, high: 12.2 }, growthPct: { low: 2.21, mid: 3.32, high: 4.43 }, cashflowLow: 99, rentTestPass: true };
const ST1: BtlJudged = { roiPct: { low: 7.4, mid: 11.2, high: 13.7 }, growthPct: { low: 2.26, mid: 3.39, high: 4.51 }, cashflowLow: 199, rentTestPass: true };
const CA2: BtlJudged = { roiPct: { low: -0.1, mid: 1.3, high: 2.7 }, growthPct: { low: 1.93, mid: 2.9, high: 3.87 }, cashflowLow: -7, rentTestPass: false };

test('income: the middle ROI beats the benchmark median (B44 passes; CH41 does not)', () => {
  assert.equal(passesFor('income', B44, BAND_50_100).pass, true);
  const ch = passesFor('income', CH41, BAND_25_50);
  assert.equal(ch.pass, false);
  assert.deepEqual(ch.failures, ['below_benchmark']);
});

test('growth: the middle growth beats the benchmark median (CH41 passes)', () => {
  assert.equal(passesFor('growth', CH41, BAND_25_50).pass, true);
  assert.equal(passesFor('growth', { ...CH41, growthPct: null }, BAND_25_50).failures.includes('no_growth_figure'), true);
});

test('a bit of both: both middles beat the 40th percentile (ST1 passes; CH41 does not)', () => {
  assert.equal(passesFor('both', ST1, BAND_25_50).pass, true);
  assert.equal(passesFor('both', CH41, BAND_25_50).pass, false);
});

test('the hard rules fail a deal whatever its priority: CA2 beats its local median and still fails', () => {
  const local = bm(-0.4, -1.6, 2.33, 2.03, { band: '50k_100k', step: 'region' });
  for (const p of ['income', 'growth', 'both'] as const) {
    const v = passesFor(p, CA2, local);
    assert.equal(v.pass, false);
    assert.equal(v.floorsOk, false);
    assert.ok(v.failures.includes('rent_test') && v.failures.includes('negative_cashflow'));
  }
  assert.equal(floorsPass(CA2), false);
  assert.equal(floorsPass({ cashflowLow: 0, rentTestPass: true }), true, '£0 at the low end passes');
});

test('too few deals to compare: the hard rules alone decide, and it says so', () => {
  const v = passesFor('income', CH41, bm(10, 9, 2, 2, { count: 4, none: true }));
  assert.equal(v.pass, true);
  assert.equal(v.compared, false);
  assert.equal(passesFor('growth', CH41, null).pass, true);
});

test('standout: the low end beats 125% of the median, never on a median of 0% or less, and income needs 6% at the low end', () => {
  assert.equal(btlStandout('income', B44, BAND_50_100), true, '6.7% ≥ both 1.0% and 6%');
  assert.equal(btlStandout('income', { ...B44, roiPct: { ...B44.roiPct, low: 5 } }, BAND_50_100), false, 'beats 125% of 0.8% but not the 6% floor');
  assert.equal(btlStandout('income', B44, bm(0, 0, 2, 2)), false, 'median 0%');
  assert.equal(btlStandout('growth', B44, bm(5, 5, 1.83, 1.37)), true, '2.6 ≥ 1.25 × 1.83');
  assert.equal(btlStandout('growth', B44, bm(5, 5, -0.5, -1)), false, 'a falling market is never a growth standout');
  assert.equal(btlStandout('income', ST1, BAND_25_50), false, '7.4% < 125% × 10.2%');
  assert.equal(btlStandout('both', CA2, BAND_50_100), false);
});

// ─── The benchmark ─────────────────────────────────────────────────────

const LEEDS = { lat: 53.8, lng: -1.55, region: 'north_east' };
function deal(milesNorth: number, roiMidPct: number, growthMidPct: number | null = 2, over: Partial<BenchmarkDeal> = {}): BenchmarkDeal {
  // One degree of latitude is about 69 miles.
  return { band: '25k_50k', lat: LEEDS.lat + milesNorth / 69, lng: LEEDS.lng, region: 'north_east', roiMidPct, growthMidPct, ...over };
}

test('widens 10, 25, 50 miles until 30 deals, and records every step', () => {
  const deals = [
    ...Array.from({ length: 10 }, (_, i) => deal(5, i)),
    ...Array.from({ length: 12 }, (_, i) => deal(20, 10 + i)),
    ...Array.from({ length: 10 }, (_, i) => deal(40, 20 + i)),
    deal(5, 99, 2, { band: '50k_100k' }),
  ];
  const b = benchmarkFor(deals, LEEDS, '25k_50k');
  assert.equal(b.step, '50mi');
  assert.equal(b.radiusMiles, 50);
  assert.equal(b.count, 32);
  assert.deepEqual(b.steps.map((s) => [s.key, s.count]), [['10mi', 10], ['25mi', 22], ['50mi', 32]]);
  assert.equal(b.roiMedianPct, 15.5);
  assert.equal(b.thin, false);
  assert.equal(benchmarkWhere(b, null), 'within 50 miles');
});

test('then the region (never smaller than the widest circle), then the whole country', () => {
  const deals = [...Array.from({ length: 5 }, (_, i) => deal(5, i)), ...Array.from({ length: 40 }, (_, i) => deal(300, i, 2, { region: 'north_west' }))];
  const b = benchmarkFor(deals, LEEDS, '25k_50k');
  assert.deepEqual(b.steps.map((s) => s.key), ['10mi', '25mi', '50mi', 'region', 'national']);
  assert.equal(b.steps[3].count, 5, 'the region holds no more than the circle');
  assert.equal(b.step, 'national');
  assert.equal(b.count, 45);
  assert.equal(benchmarkWhere(b, null), 'across the UK');
});

test('thin and none: under 30 even nationally is used and called thin; under 10 compares with nothing', () => {
  const thin = benchmarkFor(Array.from({ length: 26 }, (_, i) => deal(500, i)), LEEDS, '25k_50k');
  assert.equal(thin.step, 'national');
  assert.equal(thin.thin, true);
  assert.equal(thin.none, false);
  const none = benchmarkFor([deal(5, 1)], LEEDS, '25k_50k');
  assert.equal(none.none, true);
  const empty = benchmarkFor([], null, 'under_25k');
  assert.equal(empty.count, 0);
  assert.equal(empty.growthMedianPct, null);
});

test('the 40th percentile is the "a bit of both" bar; growth ignores deals without a figure', () => {
  const b = benchmarkFor(Array.from({ length: 30 }, (_, i) => deal(1, i, i % 2 === 0 ? i : null)), LEEDS, '25k_50k');
  assert.equal(b.roiMedianPct, 14.5);
  assert.equal(b.roiP40Pct, 11.6);
  assert.equal(b.growthMedianPct, 14);
});
