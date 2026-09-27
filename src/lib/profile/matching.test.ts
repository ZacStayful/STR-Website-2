import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLabel, placedForPreview, profileFilters } from './matching.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { areasNear } from '../onboarding/deal-filters.ts';

const goals = (over: Partial<MarketGoals>): MarketGoals => ({ ...DEFAULT_GOALS, ...over });

test('an unplaced home stands at its postcode area’s centre for the count; a placed one is left alone', () => {
  const unplaced = goals({ home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 30 });
  const placed = placedForPreview(unplaced);
  assert.deepEqual({ lat: placed.home!.lat, lng: placed.home!.lng }, areaCentroid('NG'));
  const real = goals({ home: { postcode: 'NG2 5GB', lat: 52.95, lng: -1.15 }, maxDistanceMiles: 30 });
  assert.equal(placedForPreview(real), real);
  assert.equal(placedForPreview(DEFAULT_GOALS), DEFAULT_GOALS);
});

test('the filters are the grid’s: kind, areas within the radius, the budget bounds', () => {
  const g = goals({ where: 'near', home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 30, budget: '200-350', sourcingKind: 'sale' });
  const f = profileFilters(g, []);
  assert.equal(f.kind, 'sale');
  assert.deepEqual(new Set(f.areas), new Set(areasNear(areaCentroid('NG')!, 30)));
  assert.equal(f.minPrice, 200_000);
  assert.equal(f.maxPrice, 350_000);
  // A wider radius covers at least as many areas: the slider moves the count.
  const wider = profileFilters(goals({ ...g, maxDistanceMiles: 100 }), []);
  assert.ok(wider.areas.length > f.areas.length);
  // No goals at all: the whole pool.
  assert.deepEqual(profileFilters(null, []).areas, []);
});

test('"near me + the best elsewhere" counts the whole pool; rent uses the rent ceiling', () => {
  const g = goals({ where: 'near_plus_best', home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 30, sourcingKind: 'rent', maxRentPcm: 1500 });
  const f = profileFilters(g, ['M']);
  assert.deepEqual(f.areas, []);
  assert.equal(f.kind, 'rent');
  assert.equal(f.maxPrice, 1500);
  assert.equal(f.minPrice, null);
});

test('the label reads naturally', () => {
  assert.equal(matchLabel(0, true), '0 deals match you so far');
  assert.equal(matchLabel(1, true), '1 deal matches you so far');
  assert.equal(matchLabel(1234, false), '1,234 deals match you');
  assert.equal(matchLabel(null, true), null);
});
