import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approxDistance, boundsRadiusKm, comparablesSourceLine, listingsNearbyFrom, nearbyCountLabel, readListingsNearby } from './nearby.ts';

test('radius labels', () => {
  assert.equal(approxDistance(0.197), 'about 200 m');
  assert.equal(approxDistance(0.04), 'about 50 m');
  assert.equal(approxDistance(0.95), 'about 1 km');
  assert.equal(approxDistance(1), 'about 1 km');
  assert.equal(approxDistance(2.4), 'about 2.4 km');
});

test('listingsNearbyFrom validates', () => {
  assert.deepEqual(listingsNearbyFrom(115, 0.197, 12), { count: 115, radiusKm: 0.197, area: 'box' });
  for (const bad of [Number.NaN, 0, '115', 11.5, 5]) assert.equal(listingsNearbyFrom(bad, 0.2, 12), null);
  assert.equal(listingsNearbyFrom(115, 0, 12), null);
  assert.equal(readListingsNearby({ count: 115, radiusKm: 0.2 })!.count, 115);
  assert.equal(readListingsNearby({ count: 'x' }), null);
});

test('zero-radius guard', () => {
  assert.equal(boundsRadiusKm(0.197, []), 0.197);
  assert.equal(boundsRadiusKm(0, [0.3, 1.2, undefined]), 1.2);
  assert.equal(boundsRadiusKm(0, [0.05]), 0.2);
  assert.equal(boundsRadiusKm(0, [20]), 8);
  assert.equal(boundsRadiusKm(0, []), 0);
});

test('copy', () => {
  assert.equal(nearbyCountLabel(50, 1050), '50 of about 1,050');
  assert.equal(nearbyCountLabel(40, 40), '40');
  assert.equal(nearbyCountLabel(40, null), '40');
  assert.equal(
    comparablesSourceLine({ comparables: 12, radiusKm: 0.2, nearby: { count: 115, radiusKm: 0.197, area: 'box' } }),
    '12 comparables from about 115 Airbnb listings within about 200 m',
  );
  assert.equal(comparablesSourceLine({ comparables: 12, radiusKm: 1.6, nearby: null }), '12 comparables within about 1.6 km');
  const worst = comparablesSourceLine({ comparables: 12, radiusKm: 1.6, nearby: { count: 9999, radiusKm: 1.6, area: 'box' } });
  assert.ok(worst.length <= 95, worst);
});
