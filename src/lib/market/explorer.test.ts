import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedroomStats } from './explorer.ts';
import type { MarketArea, MarketBedroomAgg } from './types.ts';

function group(p: Partial<MarketBedroomAgg>): MarketBedroomAgg {
  return {
    bedrooms: 2,
    sample_count: 8,
    avg_adr: 150,
    avg_occupancy: 62,
    avg_gross_revenue: 30000,
    avg_net_revenue: 15600,
    avg_property_value_low: 250000,
    avg_property_value_high: 350000,
    ...p,
  };
}
function area(groups: MarketBedroomAgg[]): MarketArea {
  return { postcode_area: 'M', total_sample_count: groups.reduce((s, g) => s + g.sample_count, 0), by_bedrooms: groups };
}

test('produces per-bedroom stats sorted by bedroom count', () => {
  const s = bedroomStats(area([group({ bedrooms: 3 }), group({ bedrooms: 1 })]));
  assert.deepEqual(s.map((b) => b.bedrooms), [1, 3]);
});

test('computes per-bedroom yield on the property-value midpoint', () => {
  // mid = 300000; 30000/300000 = 10.0%
  const [b] = bedroomStats(area([group({ bedrooms: 2 })]));
  assert.equal(b.propertyValueMid, 300000);
  assert.equal(b.grossYieldPct, 10);
});

test('yield is null when a bedroom group has no property value', () => {
  const [b] = bedroomStats(area([group({ avg_property_value_low: null, avg_property_value_high: null })]));
  assert.equal(b.propertyValueMid, null);
  assert.equal(b.grossYieldPct, null);
});

test('carries the bedroom sample count through', () => {
  const [b] = bedroomStats(area([group({ bedrooms: 2, sample_count: 5 })]));
  assert.equal(b.samples, 5);
});
