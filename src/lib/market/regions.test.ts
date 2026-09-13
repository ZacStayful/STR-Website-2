import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_REGION, REGIONS, isRegionSlug, regionForArea, regionForSlug } from './regions.ts';
import { AREA_CENTROIDS } from './area-centroids.ts';

test('every mapped postcode area resolves to a real region', () => {
  for (const code of Object.keys(AREA_CENTROIDS)) {
    assert.notEqual(regionForArea(code).slug, 'other', `${code} has no region`);
  }
});

test('spot checks and the four nations', () => {
  assert.equal(regionForArea('M').slug, 'north-west');
  assert.equal(regionForArea('ng').slug, 'east-midlands');
  assert.equal(regionForArea('EH').slug, 'scotland');
  assert.equal(regionForArea('BT').slug, 'northern-ireland');
  assert.equal(regionForArea('CF').slug, 'wales');
  assert.equal(regionForArea('SW').name, 'Greater London');
});

test('unknown codes fall into Other, never lost', () => {
  assert.equal(regionForArea('ZZ').slug, 'other');
  assert.equal(regionForArea(null).slug, 'other');
});

test('slugs are unique and round-trip', () => {
  const slugs = REGIONS.map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(regionForSlug('north-west')?.name, 'North West');
  assert.equal(regionForSlug('nope'), null);
  assert.ok(isRegionSlug('scotland'));
  assert.ok(!isRegionSlug('Scotland'));
  for (const slug of Object.values(AREA_REGION)) assert.ok(isRegionSlug(slug));
});
