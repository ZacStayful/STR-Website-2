import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areasNear, goalAreas, dealFiltersForGoals, dealsPathForGoals, cameFromWelcome } from './deal-filters.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { parseDealFilters } from '../marketplace/grid.ts';

const nottingham = areaCentroid('NG')!;
const goals = (over: Partial<MarketGoals>): MarketGoals => ({ ...DEFAULT_GOALS, ...over });

test('areasNear keeps every area whose centroid is inside the radius and nothing else', () => {
  const near25 = areasNear(nottingham, 25);
  const near100 = areasNear(nottingham, 100);
  assert.ok(near25.includes('NG'));
  assert.ok(near25.length < near100.length);
  for (const code of near25) assert.ok(near100.includes(code), code);
  for (const code of near100) assert.ok(haversineMiles(nottingham, areaCentroid(code)!) <= 100, code);
  assert.ok(!near100.includes('AB'), 'Aberdeen is not within 100 miles of Nottingham');
});

test('a geocoded home within a radius covers its own area and the nearby ones', () => {
  const g = goals({ home: { postcode: 'NG2 5GB', lat: nottingham.lat, lng: nottingham.lng }, maxDistanceMiles: 25 });
  const areas = goalAreas(g, []);
  assert.ok(areas.includes('NG'));
  assert.deepEqual(new Set(areas), new Set(areasNear(nottingham, 25)));
});

test('a home that could not be geocoded still covers its own area', () => {
  const g = goals({ home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 25 });
  assert.deepEqual(goalAreas(g, []), ['NG']);
});

test('saved areas are validated, uppercased and merged with the home', () => {
  const g = goals({ home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 25 });
  assert.deepEqual(goalAreas(g, ['m', 'ZZ', 'M', 'l']), ['M', 'L', 'NG']);
  assert.deepEqual(goalAreas(DEFAULT_GOALS, []), []);
});

test('buy carries the budget bounds', () => {
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'sale', budget: 'u200' }), ['NG']), { kind: 'sale', areas: ['NG'], minPrice: null, maxPrice: 200_000 });
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'sale', budget: '200-350' }), []), { kind: 'sale', areas: [], minPrice: 200_000, maxPrice: 350_000 });
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'sale', budget: null }), []), { kind: 'sale', areas: [], minPrice: null, maxPrice: null });
});

test('rent-to-rent carries the ceiling as the price cap', () => {
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'rent', maxRentPcm: 1500, budget: '500+' }), []), { kind: 'rent', areas: [], maxPrice: 1500 });
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'rent', maxRentPcm: null }), []), { kind: 'rent', areas: [], maxPrice: null });
});

test('both carries no price cap at all', () => {
  assert.deepEqual(dealFiltersForGoals(goals({ sourcingKind: 'both', budget: 'u200', maxRentPcm: 1500 }), ['M']), { kind: 'both', areas: ['M'] });
});

test('the path round-trips through the grid parser and is marked as from welcome', () => {
  const path = dealsPathForGoals(goals({ sourcingKind: 'sale', budget: '350-500' }), ['NG', 'M']);
  assert.equal(path, '/deals?kind=sale&areas=NG%2CM&minPrice=350000&maxPrice=500000&from=welcome');
  const query = Object.fromEntries(new URL(`https://x${path}`).searchParams);
  const parsed = parseDealFilters(query);
  assert.equal(parsed.kind, 'sale');
  assert.deepEqual(parsed.areas, ['NG', 'M']);
  assert.equal(parsed.minPrice, 350_000);
  assert.equal(parsed.maxPrice, 500_000);
  assert.equal(cameFromWelcome(query.from), true);
  assert.equal(dealsPathForGoals(goals({ sourcingKind: 'both' }), []), '/deals?from=welcome');
  assert.equal(cameFromWelcome(undefined), false);
  assert.equal(cameFromWelcome(['welcome']), true);
});
