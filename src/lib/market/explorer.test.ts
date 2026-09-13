import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedroomStats, competitionFor, districtCard, regionCard, MIN_DISTRICT_SAMPLES } from './explorer.ts';
import type { MarketArea, MarketBedroomAgg, MarketDistrict, MarketRegion } from './types.ts';

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

test('a district withholds its figures until it has enough reports', () => {
  const thin: MarketDistrict = { district: 'NG7', postcode_area: 'NG', total_sample_count: MIN_DISTRICT_SAMPLES - 1, by_bedrooms: [group({ sample_count: 2 })], series: [{ month: '2026-08', reports: 2, avg_adr: 1, avg_occupancy: 1, avg_gross_revenue: 1 }] };
  const d = districtCard(thin);
  assert.equal(d.ready, false);
  assert.equal(d.headline.grossRevenue, null);
  assert.equal(d.headline.totalSamples, 2);
  assert.deepEqual(d.byBedrooms, []);
  assert.deepEqual(d.series, []);
  const ok = districtCard({ ...thin, total_sample_count: MIN_DISTRICT_SAMPLES, by_bedrooms: [group({ sample_count: 3 })] });
  assert.equal(ok.ready, true);
  assert.equal(ok.headline.grossRevenue, 30000);
  assert.equal(ok.code, 'NG7');
  assert.equal(ok.areaCode, 'NG');
});

test('a region card blends its bedroom groups by sample count', () => {
  const r: MarketRegion = { slug: 'north-west', name: 'North West', areas: ['L', 'M'], total_sample_count: 12, by_bedrooms: [group({ bedrooms: 1, sample_count: 4, avg_gross_revenue: 20000 }), group({ bedrooms: 2, sample_count: 8, avg_gross_revenue: 32000 })] };
  const c = regionCard(r);
  assert.equal(c.name, 'North West');
  assert.equal(c.headline.grossRevenue, 28000);
  assert.deepEqual(c.areaCodes, ['L', 'M']);
  assert.equal(c.confidence.tier, 'confirmed');
});

test('competitionFor maps the raw review averages to a band', () => {
  const a = { ...area([group({})]), competition: { sample_count: 3, avg_rating: 4.85, avg_review_count: 60, avg_listing_age: null, avg_listing_density: null } };
  assert.equal(competitionFor(a)!.label, 'Opportunity');
  assert.equal(competitionFor(area([group({})])), null);
});

test('listing density and age surface from the competition averages, rounded, and are withheld for thin districts', () => {
  const comp = { sample_count: 3, avg_rating: 4.7, avg_review_count: 40, avg_listing_age: 2.46, avg_listing_density: 12.34 };
  const d = districtCard({ district: 'NG7', postcode_area: 'NG', total_sample_count: MIN_DISTRICT_SAMPLES, by_bedrooms: [group({ sample_count: 3 })], competition: comp });
  assert.equal(d.listingDensity, 12.3);
  assert.equal(d.listingAge, 2.5);
  const thin = districtCard({ district: 'NG7', postcode_area: 'NG', total_sample_count: 1, by_bedrooms: [group({ sample_count: 1 })], competition: comp });
  assert.equal(thin.listingDensity, null);
  assert.equal(regionCard({ slug: 'x', name: 'X', areas: [], total_sample_count: 1, by_bedrooms: [group({})] }).listingDensity, null);
});
