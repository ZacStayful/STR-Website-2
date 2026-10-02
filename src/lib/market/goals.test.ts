import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketGoals, normalisePostcode, describeGoals, DEFAULT_GOALS, parseMotivationGoals, thresholdDaysFor, parseMaxDistance, sliderMiles, sourcingKindFor, areaCodeList, GOAL_OPTIONS } from './goals.ts';

test('normalisePostcode accepts UK shapes and rejects junk', () => {
  assert.equal(normalisePostcode('ng2 5gb'), 'NG2 5GB');
  assert.equal(normalisePostcode('  M1   1AE '), 'M1 1AE');
  assert.equal(normalisePostcode('EC1A1BB'), 'EC1A 1BB');
  assert.equal(normalisePostcode('hello'), null);
  assert.equal(normalisePostcode('12345'), null);
});

test('parse rejects unknown versions and non-objects', () => {
  assert.equal(parseMarketGoals(null), null);
  assert.equal(parseMarketGoals('x'), null);
  assert.equal(parseMarketGoals({ version: 3 }), null);
  assert.equal(parseMarketGoals({}), null);
});

test('parse fills defaults for missing fields and drops invalid ones', () => {
  const g = parseMarketGoals({ version: 1, budget: 'silly', bedrooms: 9, maxDistanceMiles: 33, priorities: { yield: '3' } })!;
  assert.equal(g.budget, null);
  assert.equal(g.bedrooms, null);
  assert.equal(g.maxDistanceMiles, null);
  assert.equal(g.priorities.yield, 3);
  assert.equal(g.priorities.revenue, 2);
  assert.equal(g.management, 'managed');
  assert.equal(g.riskAppetite, 'balanced');
  assert.equal(g.home, null);
});

test('home keeps cached coordinates only when numeric', () => {
  const g = parseMarketGoals({ version: 1, home: { postcode: 'ng2 5gb', lat: 52.9, lng: 'x' } })!;
  assert.deepEqual(g.home, { postcode: 'NG2 5GB', lat: 52.9, lng: null });
});

test('maxRentPcm parses a sane band and drops everything else', () => {
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 1200 })!.maxRentPcm, 1200);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: '£1,250' })!.maxRentPcm, 1250);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 50 })!.maxRentPcm, null);
  assert.equal(parseMarketGoals({ version: 1, maxRentPcm: 'lots' })!.maxRentPcm, null);
  assert.equal(parseMarketGoals({ version: 1 })!.maxRentPcm, null);
  const chips = describeGoals({ ...DEFAULT_GOALS, sourcingKind: 'both', maxRentPcm: 1500 });
  assert.ok(chips.includes('≤ £1,500 pcm'));
  // A rent ceiling on a buy-only filter is not shown.
  assert.ok(!describeGoals({ ...DEFAULT_GOALS, maxRentPcm: 1500 }).some((c) => c.includes('pcm')));
});

test('describeGoals produces readable chips', () => {
  const chips = describeGoals({ ...DEFAULT_GOALS, home: { postcode: 'NG2 5GB', lat: null, lng: null }, maxDistanceMiles: 50, budget: '200-350', bedrooms: 2, priorities: { ...DEFAULT_GOALS.priorities, yield: 3 } });
  assert.deepEqual(chips, ['≤50 mi of NG2', '£200k–£350k', '2-bed', 'Max yield', 'Managed']);
});

// ── Motivated sellers and landlords ──

test('a profile written before the filter existed reads as off', () => {
  // Every stored profile predates this, so the parse must not invent a filter
  // nobody asked for — and must not crash on its absence either.
  const g = parseMarketGoals({ version: 1, priorities: {}, sourcingKind: 'sale' })!;
  assert.equal(g.motivation.mode, 'off');
  assert.equal(g.motivation.minMonthsOnMarket, 5);
  assert.equal(g.motivation.minWeeksOnMarket, 8);
  // Absent means the safer behaviour, not the looser one.
  assert.equal(g.motivation.areaRelative, true);
});

test('the thresholds are kept inside a sane band', () => {
  const at = (raw: unknown) => parseMotivationGoals(raw);
  assert.equal(at({ minMonthsOnMarket: 0 }).minMonthsOnMarket, 5);
  assert.equal(at({ minMonthsOnMarket: 99 }).minMonthsOnMarket, 5);
  assert.equal(at({ minMonthsOnMarket: '3' }).minMonthsOnMarket, 3);
  assert.equal(at({ minWeeksOnMarket: 200 }).minWeeksOnMarket, 8);
  assert.equal(at({ minWeeksOnMarket: 2 }).minWeeksOnMarket, 2);
  assert.equal(at({ mode: 'nonsense' }).mode, 'off');
  assert.equal(at({ mode: 'only' }).mode, 'only');
  assert.equal(at(null).mode, 'off');
});

test('months for a sale, weeks for a let', () => {
  const g = parseMotivationGoals({ minMonthsOnMarket: 5, minWeeksOnMarket: 8 });
  assert.equal(thresholdDaysFor(g, 'sale'), 152);
  assert.equal(thresholdDaysFor(g, 'rent'), 56);
});

test('the filter shows up in the summary chips only when it is on', () => {
  const base = parseMarketGoals({ version: 1, priorities: {}, sourcingKind: 'sale' })!;
  assert.ok(!describeGoals(base).some((c) => /motivated/i.test(c)));
  const only = { ...base, motivation: { ...base.motivation, mode: 'only' as const } };
  assert.ok(describeGoals(only).includes('Motivated only · 5+ mo listed'));
  const rent = { ...base, sourcingKind: 'rent' as const, motivation: { ...base.motivation, mode: 'prefer' as const } };
  assert.ok(describeGoals(rent).includes('Prefer motivated · 8+ wk listed'));
});

// ── Batch 12: version 2 ──

test('a version-1 profile reads as version 2 with the quiz fields empty, and nothing else changed', () => {
  const stored = { version: 1, home: { postcode: 'NG2 5GB', lat: 52.9, lng: -1.1 }, maxDistanceMiles: 25, budget: '200-350', bedrooms: 2, management: 'self', riskAppetite: 'cautious', sourcingKind: 'sale', finance: { depositPct: 20, mortgageRatePct: 6 }, motivation: { mode: 'prefer' } };
  const g = parseMarketGoals(stored)!;
  assert.equal(g.version, 2);
  assert.deepEqual(g.home, stored.home);
  assert.equal(g.maxDistanceMiles, 25, 'the legacy radius still reads');
  assert.equal(g.budget, '200-350');
  assert.equal(g.bedrooms, 2);
  assert.equal(g.management, 'self');
  assert.equal(g.riskAppetite, 'cautious');
  assert.equal(g.finance.depositPct, 20);
  assert.equal(g.finance.mortgageRatePct, 6);
  assert.equal(g.motivation.mode, 'prefer');
  assert.equal(g.path, null);
  assert.equal(g.where, null);
  assert.deepEqual(g.buyer, DEFAULT_GOALS.buyer);
  assert.deepEqual(g.r2r, DEFAULT_GOALS.r2r);
  assert.deepEqual(g.sourcer, DEFAULT_GOALS.sourcer);
  assert.deepEqual(g.manager, DEFAULT_GOALS.manager);
});

test('version 2 round-trips every quiz field and drops values that are not allowed', () => {
  const g: unknown = {
    ...DEFAULT_GOALS,
    path: 'r2r',
    where: 'near_plus_best',
    buyer: { ...DEFAULT_GOALS.buyer, cashAvailable: '60-100', funding: 'btl', entity: 'company', mainGoal: 'both', propertyType: 'house', condition: 'project', leaseholdOk: 'depends', restrictedAreas: 'warn' },
    r2r: { setupBudget: '3-6k', dealStructure: 'company_let', breakEvenOccupancyPct: 60, paybackMonths: 12, furnished: 'furnished' },
    sourcer: { sourceFor: 'both', sourcingFee: '2-4k', dealsPerMonth: '3-5' },
    manager: { unitsManaged: '11-30', operatingAreas: ['ng', 'M', 'ZZ', 'ng'], lookingFor: 'landlords', growthTarget: 10 },
  };
  const parsed = parseMarketGoals(g)!;
  assert.deepEqual(parseMarketGoals(JSON.parse(JSON.stringify(parsed))), parsed, 'stable through JSON');
  assert.equal(parsed.path, 'r2r');
  assert.equal(parsed.where, 'near_plus_best');
  assert.equal(parsed.buyer.propertyType, 'house');
  assert.equal(parsed.r2r.breakEvenOccupancyPct, 60);
  assert.equal(parsed.r2r.paybackMonths, 12);
  assert.deepEqual(parsed.manager.operatingAreas, ['NG', 'M'], 'validated, upper-cased, deduplicated');
  assert.equal(parsed.manager.growthTarget, 10);

  const bad = parseMarketGoals({ version: 2, path: 'sell', where: 'moon', buyer: { funding: 'gift' }, r2r: { breakEvenOccupancyPct: 65, paybackMonths: '12' }, manager: { growthTarget: 7, operatingAreas: 'NG' } })!;
  assert.equal(bad.path, null);
  assert.equal(bad.where, null);
  assert.equal(bad.buyer.funding, null);
  assert.equal(bad.r2r.breakEvenOccupancyPct, null);
  assert.equal(bad.r2r.paybackMonths, 12, 'a numeric string is fine');
  assert.equal(bad.manager.growthTarget, null);
  assert.deepEqual(bad.manager.operatingAreas, []);
});

test('the radius is 10 to 100 in tens, plus the legacy 25', () => {
  for (const ok of [10, 20, 50, 100, '30', 25]) assert.equal(parseMaxDistance(ok), Number(ok), String(ok));
  for (const bad of [0, 5, 15, 110, 'far', null, undefined, 26]) assert.equal(parseMaxDistance(bad), null, String(bad));
  assert.equal(sliderMiles(25), 30, 'a legacy 25 shows as the next step');
  assert.equal(sliderMiles(50), 50);
  assert.equal(sliderMiles(null), 50, 'a default position when there is none');
  assert.equal(sliderMiles(100), 100);
});

test('the kind searched follows the path, and a sourcer’s follows their clients', () => {
  assert.equal(sourcingKindFor('buy', null), 'sale');
  assert.equal(sourcingKindFor('r2r', null), 'rent');
  assert.equal(sourcingKindFor('manage', null), 'sale');
  assert.equal(sourcingKindFor('source', null), 'both');
  assert.equal(sourcingKindFor('source', 'buyers'), 'sale');
  assert.equal(sourcingKindFor('source', 'r2r'), 'rent');
  assert.equal(sourcingKindFor('source', 'both'), 'both');
});

test('area lists are validated and every option list is non-empty', () => {
  assert.deepEqual(areaCodeList(['ng', ' m ', 'XX', 'NG', 3]), ['NG', 'M']);
  assert.deepEqual(areaCodeList('NG'), []);
  for (const [key, values] of Object.entries(GOAL_OPTIONS)) assert.ok(values.length >= 2, key);
});

test('Batch 22c: the goal summary names every budget, the legacy Under £200k included', () => {
  assert.ok(describeGoals({ ...DEFAULT_GOALS, budget: 'u100' }).includes('Under £100k'));
  assert.ok(describeGoals({ ...DEFAULT_GOALS, budget: '100-200' }).includes('£100k–£200k'));
  assert.ok(describeGoals({ ...DEFAULT_GOALS, budget: 'u200' }).includes('Under £200k'));
  assert.equal(parseMarketGoals({ ...DEFAULT_GOALS, budget: 'u100' })?.budget, 'u100');
  assert.equal(parseMarketGoals({ ...DEFAULT_GOALS, budget: 'u200' })?.budget, 'u200', 'a stored legacy answer is kept');
});
