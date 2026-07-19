import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeYieldOnCost } from './yield.ts';
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
  return {
    postcode_area: 'NG',
    total_sample_count: groups.reduce((s, g) => s + g.sample_count, 0),
    by_bedrooms: groups,
  };
}

test('computes gross yield on the value midpoint', () => {
  // value mid = (250000 + 350000)/2 = 300000; 30000/300000 = 10.0%
  const y = computeYieldOnCost(area([group({})]));
  assert.equal(y?.grossYieldPct, 10);
  assert.equal(y?.propertyValueMid, 300000);
});

test('computes net yield when net revenue present', () => {
  // 15600/300000 = 5.2%
  const y = computeYieldOnCost(area([group({})]));
  assert.equal(y?.netYieldPct, 5.2);
});

test('sample-weights across bedroom groups', () => {
  // group A: gross 30000, n=10, value mid 300000
  // group B: gross 60000, n=30, value mid 600000
  // weighted gross = (30000*10 + 60000*30)/40 = 52500
  // weighted value = (300000*10 + 600000*30)/40 = 525000
  // yield = 52500/525000 = 10.0%
  const y = computeYieldOnCost(
    area([
      group({ bedrooms: 1, sample_count: 10, avg_gross_revenue: 30000, avg_property_value_low: 250000, avg_property_value_high: 350000 }),
      group({ bedrooms: 3, sample_count: 30, avg_gross_revenue: 60000, avg_property_value_low: 550000, avg_property_value_high: 650000 }),
    ]),
  );
  assert.equal(y?.grossYieldPct, 10);
  assert.equal(y?.sampleCount, 40);
});

test('returns null when property values are null (never divides by null)', () => {
  const y = computeYieldOnCost(
    area([group({ avg_property_value_low: null, avg_property_value_high: null })]),
  );
  assert.equal(y, null);
});

test('ignores groups with null value but uses those with a value', () => {
  // Only the 3-bed group has a value; yield computed from it alone.
  const y = computeYieldOnCost(
    area([
      group({ bedrooms: 1, sample_count: 5, avg_gross_revenue: 26000, avg_property_value_low: null, avg_property_value_high: null }),
      group({ bedrooms: 3, sample_count: 10, avg_gross_revenue: 35000, avg_property_value_low: 180000, avg_property_value_high: 240000 }),
    ]),
  );
  // value mid = 210000; 35000/210000 = 16.666..% → 16.7
  assert.equal(y?.grossYieldPct, 16.7);
  assert.equal(y?.sampleCount, 10); // only the value-backed group counts
});

test('net yield is null when net revenue missing but gross yield still computes', () => {
  const y = computeYieldOnCost(area([group({ avg_net_revenue: null })]));
  assert.equal(y?.grossYieldPct, 10);
  assert.equal(y?.netYieldPct, null);
});

test('returns null when gross revenue is null even if value present', () => {
  const y = computeYieldOnCost(area([group({ avg_gross_revenue: null })]));
  assert.equal(y, null);
});

test('returns null for an area with no bedroom groups', () => {
  assert.equal(computeYieldOnCost(area([])), null);
});

test('guards against a zero property value', () => {
  const y = computeYieldOnCost(area([group({ avg_property_value_low: 0, avg_property_value_high: 0 })]));
  assert.equal(y, null);
});
