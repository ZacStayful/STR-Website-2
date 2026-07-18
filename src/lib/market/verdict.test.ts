import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAreaVerdict, buildAreaShortLet } from './verdict.ts';
import { calculateFinancials } from '../analysis.ts';
import type { MarketArea, MarketBedroomAgg } from './types.ts';

function group(p: Partial<MarketBedroomAgg>): MarketBedroomAgg {
  return {
    bedrooms: 2,
    sample_count: 10,
    avg_adr: 150,
    avg_occupancy: 60,
    avg_gross_revenue: 30000,
    avg_net_revenue: 15600,
    avg_property_value_low: 250000,
    avg_property_value_high: 350000,
    ...p,
  };
}
function area(groups: MarketBedroomAgg[]): MarketArea {
  return { postcode_area: 'NG', total_sample_count: groups.reduce((s, g) => s + g.sample_count, 0), by_bedrooms: groups };
}

test('verdict is produced by analysis.ts calculateFinancials, fed the area long-let', () => {
  const a = area([group({})]);
  const v = computeAreaVerdict(a, 1200);
  // Cross-check against calling the single source of truth directly.
  const expected = calculateFinancials(buildAreaShortLet(a)!, {
    monthlyRent: 1200, estimateHigh: 1380, estimateLow: 1020, comparables: [],
  });
  assert.deepEqual(v?.financials, expected);
});

test('short-let wins when its net beats the long-let net by > band', () => {
  // shortNet = 30000*0.52 = 15600; longNet = 1200*12*0.9 = 12960; diff = +2640
  const v = computeAreaVerdict(area([group({})]), 1200);
  assert.equal(v?.winner, 'short-let');
  assert.equal(v?.annualAdvantage, 2640);
  assert.equal(v?.monthlyAdvantage, 220);
  assert.equal(v?.breakEvenOccupancyPct, 46);
});

test('long-let wins when its net is higher', () => {
  // longNet = 3000*12*0.9 = 32400 >> shortNet 15600
  const v = computeAreaVerdict(area([group({})]), 3000);
  assert.equal(v?.winner, 'long-let');
  assert.equal(v?.annualAdvantage, 16800);
});

test('toss-up when the two strategies are within the band', () => {
  // longNet ≈ shortNet at monthlyRent ≈ 1444
  const v = computeAreaVerdict(area([group({})]), 1444);
  assert.equal(v?.winner, 'toss-up');
});

test('returns null when there is no long-let comparator (graceful degradation)', () => {
  assert.equal(computeAreaVerdict(area([group({})]), null), null);
  assert.equal(computeAreaVerdict(area([group({})]), 0), null);
});

test('returns null when the area has no short-let revenue data', () => {
  const v = computeAreaVerdict(area([group({ avg_gross_revenue: null, avg_adr: null })]), 1200);
  assert.equal(v, null);
});

test('buildAreaShortLet sample-weights and converts occupancy to a fraction', () => {
  const s = buildAreaShortLet(
    area([
      group({ sample_count: 10, avg_gross_revenue: 20000, avg_adr: 100, avg_occupancy: 50 }),
      group({ sample_count: 30, avg_gross_revenue: 40000, avg_adr: 200, avg_occupancy: 70 }),
    ]),
  );
  // weighted gross = (20000*10 + 40000*30)/40 = 35000
  assert.equal(s?.annualRevenue, 35000);
  // weighted adr = (100*10 + 200*30)/40 = 175
  assert.equal(s?.averageDailyRate, 175);
  // weighted occ % = (50*10 + 70*30)/40 = 65 → fraction 0.65
  assert.equal(s?.occupancyRate, 0.65);
});
