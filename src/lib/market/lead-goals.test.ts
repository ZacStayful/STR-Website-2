import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadGoals, areaCodeFrom, budgetFrom, bedroomsFrom, kindFrom } from './lead-goals.ts';

test('area from a code, a postcode, a slug or a name', () => {
  assert.equal(areaCodeFrom('yo'), 'YO');
  assert.equal(areaCodeFrom('YO10 4AB'), 'YO');
  assert.equal(areaCodeFrom('york'), 'YO');
  assert.equal(areaCodeFrom('York'), 'YO');
  assert.equal(areaCodeFrom('Atlantis'), null);
  assert.equal(areaCodeFrom(''), null);
  assert.equal(areaCodeFrom(undefined), null);
});

test('budget from a band, a number or words', () => {
  assert.equal(budgetFrom('200-350'), '200-350');
  assert.equal(budgetFrom(180000), 'u200');
  assert.equal(budgetFrom('£250,000'), '200-350');
  assert.equal(budgetFrom('under 200k'), 'u200');
  assert.equal(budgetFrom('up to 400k'), '350-500');
  assert.equal(budgetFrom('350k - 500k'), '350-500');
  assert.equal(budgetFrom('600000'), '500+');
  assert.equal(budgetFrom('not sure'), null);
});

test('bedrooms and kind', () => {
  assert.equal(bedroomsFrom('3 bed'), 3);
  assert.equal(bedroomsFrom(5), 4);
  assert.equal(bedroomsFrom('any'), null);
  assert.equal(kindFrom('Buy'), 'sale');
  assert.equal(kindFrom('rent-to-rent'), 'rent');
  assert.equal(kindFrom('Either'), 'both');
  assert.equal(kindFrom(undefined), 'sale');
});

test('parseLeadGoals builds valid goals and never throws on junk', () => {
  const { goals, areaCode } = parseLeadGoals({ area: 'York', postcode: 'YO10 4AB', budget: '£250,000', bedrooms: '3', kind: 'buy' });
  assert.equal(areaCode, 'YO');
  assert.deepEqual(goals.home, { postcode: 'YO10 4AB', lat: null, lng: null });
  assert.equal(goals.maxDistanceMiles, 25);
  assert.equal(goals.budget, '200-350');
  assert.equal(goals.bedrooms, 3);
  assert.equal(goals.sourcingKind, 'sale');
  const junk = parseLeadGoals({ area: 42, budget: {}, bedrooms: null, kind: [] });
  assert.equal(junk.areaCode, null);
  assert.equal(junk.goals.home, null);
  assert.equal(junk.goals.budget, null);
  assert.equal(junk.goals.sourcingKind, 'sale');
  const rent = parseLeadGoals({ area: 'BS', kind: 'rent', maxRentPcm: '£1,400' });
  assert.equal(rent.goals.sourcingKind, 'rent');
  assert.equal(rent.goals.maxRentPcm, 1400);
});
