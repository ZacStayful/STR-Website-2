import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { areaScores, buildDemand, cellKey, demandScore, kindsOf, leftOut, nearAreas, planSearches, profileAreas, summariseToday, typeOf, type AreaData, type DemandMember, type DemandProfile, type PlanOptions } from './demand.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const seen = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();
const ELIG = { adminEmails: ['zac@stayful.co.uk'], activeDays: 30, now: NOW };
const AREAS = { radiusAreas: 5, maxAreasPerProfile: 10 };
const OPTS = { ...ELIG, ...AREAS };

/** Coalville, LE67: LE 15 mi, DE 19, WS 23, CV 28, B 29, NG 30, ST 34 (area centroids). */
const COALVILLE = { postcode: 'LE67 3AB', lat: 52.7229, lng: -1.3706 };

/** A profile's goals; its deal types follow the kind it searches unless given (Batch 17: the types decide the kinds). */
const TYPES_OF: Record<MarketGoals['sourcingKind'], MarketGoals['dealTypes']> = { sale: ['buy_str'], rent: ['r2r'], both: ['buy_str', 'r2r'] };
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over, dealTypes: over.dealTypes !== undefined ? over.dealTypes : TYPES_OF[over.sourcingKind ?? 'sale'] });
const member = (id: string, over: Partial<DemandMember> = {}): DemandMember => ({ id, email: `${id}@example.com`, lastSeenAt: seen(1), payerId: id, paying: false, unitAreas: [], switchedOff: false, ...over });
const profile = (memberId: string, g: MarketGoals | null, areas: string[] = [], profileId: string | null = `${memberId}-p`): DemandProfile => ({ memberId, profileId, goals: g, areas });

test('leftOut: staff, admins and switched-off accounts, and anyone not seen within the window', () => {
  assert.equal(leftOut(member('a'), ELIG), null);
  assert.equal(leftOut(member('a', { email: 'Zac@Stayful.co.uk' }), ELIG), 'staff');
  assert.equal(leftOut(member('a', { email: 'someone@stayful.co.uk' }), ELIG), 'staff');
  assert.equal(leftOut(member('a', { switchedOff: true }), ELIG), 'staff');
  assert.equal(leftOut(member('a', { lastSeenAt: seen(29) }), ELIG), null);
  assert.equal(leftOut(member('a', { lastSeenAt: seen(31) }), ELIG), 'inactive');
  assert.equal(leftOut(member('a', { lastSeenAt: null }), ELIG), 'inactive', 'a lead-provisioned account that never signed in');
  assert.equal(leftOut(member('a', { lastSeenAt: 'garbage' }), ELIG), 'inactive');
});

test('nearAreas: the home area, then the nearest areas inside the radius, at most N', () => {
  const g = (miles: number) => goals({ home: COALVILLE, maxDistanceMiles: miles });
  assert.deepEqual(nearAreas(g(30), 5), ['LE', 'DE', 'WS', 'CV', 'B', 'NG']);
  assert.deepEqual(nearAreas(g(30), 2), ['LE', 'DE', 'WS']);
  assert.deepEqual(nearAreas(g(20), 5), ['LE', 'DE']);
  assert.deepEqual(nearAreas(g(10), 5), ['LE'], 'nothing else inside ten miles: just the home area');
  assert.deepEqual(nearAreas(g(100), 0), ['LE'], 'N = 0: the home area only');
  assert.deepEqual(nearAreas(goals({ home: null, maxDistanceMiles: 50 }), 5), []);
});

test('nearAreas: a home not yet placed on the map stands in at its postcode area’s centre', () => {
  const out = nearAreas(goals({ home: { postcode: 'LE67 3AB', lat: null, lng: null }, maxDistanceMiles: 100 }), 5);
  assert.equal(out[0], 'LE');
  assert.equal(out.length, 6);
});

test('profileAreas: "most profitable anywhere" and no answers yet add nothing, not even units', () => {
  assert.deepEqual(profileAreas(profile('a', goals({ where: 'anywhere' }), ['BA']), ['YO'], AREAS), []);
  assert.deepEqual(profileAreas(profile('a', null, ['BA']), ['YO'], AREAS), []);
});

test('profileAreas: chosen areas, validated and upper-cased, plus units and operating areas', () => {
  const g = goals({ where: 'areas', manager: { ...DEFAULT_GOALS.manager, operatingAreas: ['M', 'zz'] } });
  assert.deepEqual(profileAreas(profile('a', g, ['ba', 'YO', 'nope', 'BA']), ['HG'], AREAS), ['BA', 'YO', 'HG', 'M']);
});

test('profileAreas: near me and near me + the best elsewhere both add the home area and its nearest areas', () => {
  const near = goals({ where: 'near', home: COALVILLE, maxDistanceMiles: 20 });
  assert.deepEqual(profileAreas(profile('a', near), [], AREAS), ['LE', 'DE']);
  assert.deepEqual(profileAreas(profile('a', { ...near, where: 'near_plus_best' }), [], AREAS), ['LE', 'DE']);
  assert.deepEqual(profileAreas(profile('a', near, ['YO']), [], AREAS), ['LE', 'DE'], 'chosen areas are not part of a near-me answer');
});

test('profileAreas: older profiles (no where answer) take chosen areas plus home and radius when both are set', () => {
  assert.deepEqual(profileAreas(profile('a', goals({ where: null, home: COALVILLE, maxDistanceMiles: 20 }), ['YO']), [], AREAS), ['YO', 'LE', 'DE']);
  assert.deepEqual(profileAreas(profile('a', goals({ where: null, home: COALVILLE, maxDistanceMiles: null }), ['YO']), [], AREAS), ['YO'], 'a home with no radius adds nothing');
  assert.deepEqual(profileAreas(profile('a', goals({ where: null, home: COALVILLE, maxDistanceMiles: null })), ['HG'], AREAS), [], 'no chosen areas and no radius: anywhere');
  assert.deepEqual(profileAreas(profile('a', goals({ where: null })), ['HG'], AREAS), []);
});

test('profileAreas: never more than the per-profile cap, chosen and unit areas first', () => {
  const g = goals({ where: 'areas' });
  const chosen = ['BA', 'BS', 'YO', 'HG', 'SO', 'PO', 'GL', 'CT', 'NW', 'W', 'E', 'SE'];
  const out = profileAreas(profile('a', g, chosen), ['LE'], { radiusAreas: 5, maxAreasPerProfile: 10 });
  assert.equal(out.length, 10);
  assert.deepEqual(out, ['BA', 'BS', 'YO', 'HG', 'SO', 'PO', 'GL', 'CT', 'NW', 'W']);
  const near = goals({ where: 'near', home: COALVILLE, maxDistanceMiles: 100 });
  assert.deepEqual(profileAreas(profile('a', near), ['YO', 'BA'], { radiusAreas: 5, maxAreasPerProfile: 4 }), ['YO', 'BA', 'LE', 'DE'], 'units first, then home and the nearest');
});

test('kindsOf and typeOf', () => {
  assert.deepEqual(kindsOf(goals({ sourcingKind: 'both' })), ['sale', 'rent']);
  assert.deepEqual(kindsOf(goals({ sourcingKind: 'rent' })), ['rent']);
  // Batch 17: the deal types decide; BRRR is a sale search.
  assert.deepEqual(kindsOf(goals({ dealTypes: ['brrr'] })), ['sale']);
  assert.deepEqual(kindsOf(goals({ dealTypes: ['brrr', 'r2r'] })), ['sale', 'rent']);
  // Not yet on types: the roles ticked, else what an unanswered profile is shown (Q22).
  assert.deepEqual(kindsOf(goals({ dealTypes: null }), ['r2r']), ['rent']);
  assert.deepEqual(kindsOf(goals({ dealTypes: null }), ['investor']), ['sale']);
  assert.deepEqual(kindsOf(goals({ dealTypes: null })), ['sale', 'rent']);
  const flatBuyer = goals({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' } });
  assert.equal(typeOf(flatBuyer, 'sale'), 'flat');
  assert.equal(typeOf(flatBuyer, 'rent'), 'any', 'rent-to-rent has no type answer');
  assert.equal(typeOf(goals({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'either' } }), 'sale'), 'any');
  assert.equal(typeOf(goals(), 'sale'), 'any');
});

test('buildDemand: members count once per area however many profiles they have', () => {
  const g = goals({ where: 'areas', sourcingKind: 'sale' });
  const d = buildDemand([member('a'), member('b')], [profile('a', g, ['LE'], 'a1'), profile('a', g, ['LE'], 'a2'), profile('a', g, ['LE'], 'a3'), profile('b', g, ['LE'])], OPTS);
  const c = d.cells.get(cellKey('LE', 'sale'))!;
  assert.equal(c.members.size, 2);
  assert.equal(c.profiles, 4);
  assert.equal(d.summary.members, 2);
  assert.equal(d.summary.profiles, 4);
});

test('buildDemand: a team counts once, as the account that pays, and paying follows that account', () => {
  const g = goals({ where: 'areas', sourcingKind: 'rent' });
  const d = buildDemand(
    [member('owner', { paying: true }), member('seat', { payerId: 'owner', paying: true }), member('solo')],
    [profile('owner', g, ['CT']), profile('seat', g, ['CT']), profile('solo', g, ['CT'])],
    OPTS,
  );
  const c = d.cells.get(cellKey('CT', 'rent'))!;
  assert.equal(c.members.size, 2, 'owner and seat are one team');
  assert.equal(c.paying.size, 1);
  assert.equal(c.profiles, 3);
});

test('buildDemand: staff, switched-off and inactive members add nothing, and are counted as left out', () => {
  const g = goals({ where: 'areas' });
  const d = buildDemand(
    [member('a'), member('staff', { email: 'x@stayful.co.uk' }), member('old', { lastSeenAt: seen(90) }), member('off', { switchedOff: true })],
    [profile('a', g, ['LE']), profile('staff', g, ['LE']), profile('old', g, ['LE']), profile('off', g, ['LE'])],
    OPTS,
  );
  assert.equal(d.cells.get(cellKey('LE', 'sale'))!.members.size, 1);
  assert.deepEqual(d.summary.leftOut, { staff: 2, inactive: 1 });
});

test('buildDemand: a "both" profile counts toward buy and rent-to-rent, with its type and must-haves', () => {
  const g = goals({ where: 'areas', sourcingKind: 'both', budget: '200-350', maxRentPcm: 2500, bedrooms: 3, buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'house' } });
  const d = buildDemand([member('a')], [profile('a', g, ['LE'])], OPTS);
  const sale = d.cells.get(cellKey('LE', 'sale'))!;
  const rent = d.cells.get(cellKey('LE', 'rent'))!;
  assert.equal(sale.byType.house.members.size, 1);
  assert.equal(sale.byType.any.members.size, 0);
  assert.equal(rent.byType.any.members.size, 1);
  assert.equal(sale.budgets.get('200-350'), 1);
  assert.deepEqual(rent.maxRents, [2500]);
  assert.equal(sale.bedrooms.get(3), 1);
});

test('buildDemand: anywhere profiles and profiles with no answers count as read but add no areas', () => {
  const d = buildDemand([member('a'), member('b')], [profile('a', goals({ where: 'anywhere' })), profile('b', null)], OPTS);
  assert.equal(d.cells.size, 0);
  assert.equal(d.summary.profiles, 2);
  assert.equal(d.summary.profilesWithoutAreas, 2);
});

test('buildDemand copes with nobody at all', () => {
  const d = buildDemand([], [], OPTS);
  assert.equal(d.cells.size, 0);
  assert.deepEqual(d.summary, { members: 0, profiles: 0, profilesWithoutAreas: 0, leftOut: { staff: 0, inactive: 0 } });
});

test('the live members today: LE67 (100 mi, both) and CT2 (25 mi, rent) do not overlap', () => {
  const le = goals({ home: COALVILLE, maxDistanceMiles: 100, sourcingKind: 'both' });
  const ct = goals({ home: { postcode: 'CT2 7NZ', lat: 51.28, lng: 1.08 }, maxDistanceMiles: 25, sourcingKind: 'rent' });
  const d = buildDemand([member('a'), member('b')], [profile('a', le), profile('b', ct)], OPTS);
  assert.ok([...d.cells.values()].every((c) => c.members.size === 1));
  assert.deepEqual([...new Set([...d.cells.values()].filter((c) => c.kind === 'rent').map((c) => c.area))].sort(), ['B', 'CT', 'CV', 'DE', 'LE', 'ME', 'NG', 'WS']);
});

test('demandScore and areaScores: paying members weigh more in the order, and an area takes its best kind', () => {
  assert.equal(demandScore({ members: new Set(['a', 'b', 'c']), paying: new Set(['a']) }, 2), 4);
  assert.equal(demandScore({ members: new Set(['a', 'b', 'c']), paying: new Set(['a']) }, 1), 3);
  const g = goals({ where: 'areas' });
  const d = buildDemand([member('a', { paying: true }), member('b')], [profile('a', goals({ where: 'areas', sourcingKind: 'rent' }), ['LE']), profile('b', g, ['LE'])], OPTS);
  assert.deepEqual([...areaScores(d, 2)], [['LE', 2]]);
});

const data = (entries: [string, AreaData][]) => new Map(entries);
const planOpts = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  minMembers: 2,
  payingWeight: 2,
  sweepAreas: new Set(),
  areaData: data([
    ['LE', { screenable: true, early: false }],
    ['IV', { screenable: true, early: true }],
    ['ZE', { screenable: false, early: false }],
    ['HG', { screenable: true, early: false }],
  ]),
  searchedToday: new Set(),
  gaveUpToday: new Set(),
  liveDeals: new Map(),
  ...over,
});

function demandOf(entries: [string, 'sale' | 'rent', string[], string[]?][]) {
  // [area, kind, member ids, paying member ids]
  const members = new Map<string, DemandMember>();
  const profiles: DemandProfile[] = [];
  for (const [area, kind, ids, payingIds = []] of entries) {
    for (const id of ids) {
      if (!members.has(id)) members.set(id, member(id, { paying: payingIds.includes(id) }));
      profiles.push(profile(id, goals({ where: 'areas', sourcingKind: kind }), [area], `${id}-${area}-${kind}`));
    }
  }
  return buildDemand([...members.values()], profiles, OPTS);
}

test('planSearches: added at the threshold, skipped below it, in the sweep, without data, or already done today', () => {
  const d = demandOf([
    ['LE', 'sale', ['a', 'b']],
    ['IV', 'rent', ['a', 'b', 'c']],
    ['ZE', 'sale', ['a', 'b']],
    ['HG', 'sale', ['a']],
    ['BA', 'sale', ['a', 'b']],
    ['LE', 'rent', ['a', 'b']],
  ]);
  const plan = planSearches(d, planOpts({ sweepAreas: new Set(['BA']), searchedToday: new Set(['rent|LE|||']) }));
  assert.deepEqual(plan.searches.map((s) => s.key), ['rent|IV|||', 'sale|LE|||']);
  assert.equal(plan.searches[0].early, true, 'IV is searched, flagged as thin data');
  const why = Object.fromEntries(plan.skipped.map((s) => [`${s.area}|${s.kind}`, s.reason]));
  assert.deepEqual(why, { 'HG|sale': 'below_threshold', 'BA|sale': 'in_sweep', 'ZE|sale': 'no_data', 'LE|rent': 'searched_today' });
});

test('planSearches: a cell with no answer too often today waits until tomorrow', () => {
  const d = demandOf([
    ['LE', 'sale', ['a', 'b']],
    ['IV', 'sale', ['a', 'b']],
  ]);
  const plan = planSearches(d, planOpts({ gaveUpToday: new Set(['sale|LE|||']) }));
  assert.deepEqual(plan.searches.map((s) => s.key), ['sale|IV|||']);
  assert.deepEqual(plan.skipped.map((s) => [s.area, s.reason]), [['LE', 'no_answer_today']]);
});

test('summariseToday: reserved or answered is done for the day; no answer twice is left until tomorrow', () => {
  const t = summariseToday(
    [
      { query_key: 'sale|LE|||', status: 'answered' },
      { query_key: 'rent|LE|||', status: 'reserved' },
      { query_key: 'sale|IV|||', status: 'unavailable' },
      { query_key: 'sale|IV|||', status: 'failed' },
      { query_key: 'rent|IV|||', status: 'unavailable' },
      { query_key: 'sale|HG|||', status: 'unavailable' },
      { query_key: 'sale|HG|||', status: 'unavailable' },
      { query_key: 'sale|HG|||', status: 'answered' },
    ],
    2,
  );
  assert.deepEqual([...t.searched].sort(), ['rent|LE|||', 'sale|HG|||', 'sale|LE|||']);
  assert.deepEqual([...t.gaveUp], ['sale|IV|||'], 'one miss is tried again; a key answered in the end is simply done');
  assert.deepEqual(summariseToday([], 2), { searched: new Set(), gaveUp: new Set() });
});

test('planSearches: paying members, then profiles, then fewer live deals, then the code decide the order', () => {
  const d = demandOf([
    ['LE', 'sale', ['a', 'b']],
    ['HG', 'sale', ['c', 'd'], ['c']],
    ['IV', 'sale', ['e', 'f']],
  ]);
  const areaData = data([
    ['LE', { screenable: true, early: false }],
    ['HG', { screenable: true, early: false }],
    ['IV', { screenable: true, early: false }],
  ]);
  const plan = planSearches(d, planOpts({ areaData, liveDeals: new Map([[cellKey('LE', 'sale'), 5]]) }));
  assert.deepEqual(plan.searches.map((s) => s.area), ['HG', 'IV', 'LE'], 'HG has a paying member; IV beats LE on fewer live deals');
  assert.equal(plan.searches[0].score, 3);
});

test('planSearches with the threshold at one member adds single-member areas', () => {
  const d = demandOf([['LE', 'sale', ['a']]]);
  assert.equal(planSearches(d, planOpts({ minMembers: 1 })).searches.length, 1);
  assert.equal(planSearches(d, planOpts()).searches.length, 0);
});
