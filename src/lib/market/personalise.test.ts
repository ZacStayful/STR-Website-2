import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personaliseScore, personalInputFor, type PersonalInput } from './personalise.ts';
import { DEFAULT_GOALS, type MarketGoals } from './goals.ts';

const input = (over: Partial<PersonalInput> = {}): PersonalInput => ({
  code: 'M', grossYieldPct: 9, grossRevenue: 28000, occupancyPct: 63, competitionPercentile: 50,
  directBookingScore: 50, licensing: 'confirmed-unrestricted', propertyValueMid: 300000, bedroomsAvailable: [1, 2, 3],
  ...over,
});
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over });

test('score is 0–100 and every component is explained', () => {
  const s = personaliseScore(input(), goals())!;
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(s.components.length, 7);
  for (const c of s.components) assert.ok(c.detail.length > 0);
});

test('perfect inputs score 100 regardless of weights', () => {
  const s = personaliseScore(input({ grossYieldPct: 20, grossRevenue: 60000, occupancyPct: 90, competitionPercentile: 0, directBookingScore: 100 }), goals())!;
  assert.equal(s.score, 100);
  assert.equal(s.grade, 'A');
});

test('priority extremes flip a ranking between a high-yield/busy area and a low-yield/open one', () => {
  const busyHighYield = input({ code: 'A', grossYieldPct: 13, competitionPercentile: 95 });
  const openLowYield = input({ code: 'B', grossYieldPct: 6, competitionPercentile: 5 });
  const yieldFirst = goals({ priorities: { yield: 3, revenue: 2, lowCompetition: 0, directBookings: 2 } });
  const quietFirst = goals({ priorities: { yield: 0, revenue: 2, lowCompetition: 3, directBookings: 2 } });
  assert.ok(personaliseScore(busyHighYield, yieldFirst)!.score > personaliseScore(openLowYield, yieldFirst)!.score);
  assert.ok(personaliseScore(openLowYield, quietFirst)!.score > personaliseScore(busyHighYield, quietFirst)!.score);
});

test('cautious vs tolerant moves a licensed area', () => {
  const licensed = input({ licensing: 'confirmed-licensed' });
  const cautious = personaliseScore(licensed, goals({ riskAppetite: 'cautious' }))!.score;
  const tolerant = personaliseScore(licensed, goals({ riskAppetite: 'tolerant' }))!.score;
  assert.ok(cautious < tolerant);
});

test('distance is dropped without a home, and scores by range with one', () => {
  const none = personaliseScore(input(), goals())!;
  assert.equal(none.components.find((c) => c.key === 'distance')!.earned, null);
  assert.equal(none.fit.distanceMiles, null);

  const home = { postcode: 'M1 1AE', lat: 53.48, lng: -2.24 }; // Manchester
  const near = personaliseScore(input({ code: 'M' }), goals({ home, maxDistanceMiles: 50 }))!;
  assert.ok(near.fit.distanceMiles! < 10);
  assert.equal(near.fit.inRange, true);
  const far = personaliseScore(input({ code: 'EH' }), goals({ home, maxDistanceMiles: 50 }))!;
  assert.equal(far.fit.inRange, false);
  assert.equal(far.components.find((c) => c.key === 'distance')!.earned, 0);
  assert.ok(far.score < near.score);

  const anywhere = personaliseScore(input({ code: 'EH' }), goals({ home, maxDistanceMiles: null }))!;
  assert.equal(anywhere.components.find((c) => c.key === 'distance')!.earned, null);
  assert.ok(anywhere.fit.distanceMiles! > 100);
});

test('budget and bedroom fit are flags, not score killers', () => {
  const s = personaliseScore(input({ propertyValueMid: 600000, bedroomsAvailable: [1] }), goals({ budget: 'u200', bedrooms: 3 }))!;
  assert.equal(s.fit.inBudget, false);
  assert.equal(s.fit.hasBedrooms, false);
  assert.ok(s.score > 0);
  const unknown = personaliseScore(input({ propertyValueMid: null }), goals({ budget: 'u200' }))!;
  assert.equal(unknown.fit.inBudget, null);
});

test('null when there is no performance data at all', () => {
  assert.equal(personaliseScore(input({ grossYieldPct: null, grossRevenue: null, occupancyPct: null }), goals()), null);
});

test('personalInputFor uses the goal bedroom group for the budget value, "4+" taking the smallest ≥4', () => {
  const card = {
    code: 'M', headline: { grossRevenue: 1, occupancy: 1, bedroomsAvailable: [2, 5] }, yieldOnCost: { grossYieldPct: 1, propertyValueMid: 999 },
    byBedrooms: [{ bedrooms: 2, propertyValueMid: 200 }, { bedrooms: 5, propertyValueMid: 500 }],
    competition: null, directBooking: null, licensing: { status: 'unconfirmed' },
  } as never;
  assert.equal(personalInputFor(card, goals({ bedrooms: 2 })).propertyValueMid, 200);
  assert.equal(personalInputFor(card, goals({ bedrooms: 4 })).propertyValueMid, 500);
  assert.equal(personalInputFor(card, goals({ bedrooms: 3 })).propertyValueMid, 999);
  assert.equal(personalInputFor(card, goals({ bedrooms: null })).propertyValueMid, 999);
});
