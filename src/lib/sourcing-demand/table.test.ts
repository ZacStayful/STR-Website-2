import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { buildDemand, planSearches, type DemandMember, type DemandProfile, type PlanOptions } from './demand.ts';
import { defaultDir, demandRows, isSortKey, mustHavesOf, planView, sortRows, supplyFrom, type DemandRow, type RowInputs } from './table.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const OPTS = { adminEmails: [], activeDays: 30, now: NOW, radiusAreas: 5, maxAreasPerProfile: 10 };
const member = (id: string, paying = false): DemandMember => ({ id, email: `${id}@example.com`, lastSeenAt: NOW.toISOString(), payerId: id, paying, unitAreas: [], switchedOff: false });
/** A profile's goals; its deal types follow the kind it searches unless given (Batch 17: the types decide the kinds). */
const TYPES_OF: Record<MarketGoals['sourcingKind'], MarketGoals['dealTypes']> = { sale: ['buy_str'], rent: ['r2r'], both: ['buy_str', 'r2r'] };
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, where: 'areas', ...over, dealTypes: over.dealTypes !== undefined ? over.dealTypes : TYPES_OF[over.sourcingKind ?? 'sale'] });
const buyer = (propertyType: 'house' | 'flat' | 'either' | null, over: Partial<MarketGoals> = {}) => goals({ sourcingKind: 'sale', buyer: { ...DEFAULT_GOALS.buyer, propertyType }, ...over });
const profile = (memberId: string, g: MarketGoals, areas: string[]): DemandProfile => ({ memberId, profileId: `${memberId}-${areas.join('')}`, goals: g, areas });

const EMPTY = { byCell: new Map(), unknown: new Map() };

function inputs({ gaveUpToday, ...over }: Partial<RowInputs> & Pick<RowInputs, 'demand'> & { gaveUpToday?: Set<string> }): RowInputs {
  const planOpts: PlanOptions = {
    minMembers: 2,
    payingWeight: 2,
    sweepAreas: over.sweepAreas ?? new Set(),
    areaData: new Map([
      ['LE', { screenable: true, early: false }],
      ['IV', { screenable: true, early: true }],
      ['ZE', { screenable: false, early: false }],
      ['BA', { screenable: true, early: false }],
    ]),
    searchedToday: new Set(),
    gaveUpToday: gaveUpToday ?? new Set(),
    liveDeals: new Map(),
  };
  return { plan: planSearches(over.demand, planOpts), sweepAreas: new Set(), sweepDoneToday: new Set(), live: EMPTY, added: EMPTY, capReached: false, includeUnwanted: false, ...over };
}

test('supplyFrom sorts the pool into house and flat by the portal’s type, and counts the rest as unknown', () => {
  const s = supplyFrom([
    { postcode_area: 'le', kind: 'sale', raw_type: 'Detached house' },
    { postcode_area: 'LE', kind: 'sale', raw_type: 'Flat' },
    { postcode_area: 'LE', kind: 'sale', raw_type: 'Apartment' },
    { postcode_area: 'LE', kind: 'sale', raw_type: 'Property' },
    { postcode_area: 'LE', kind: 'sale', raw_type: null },
    { postcode_area: 'LE', kind: 'rent', raw_type: 'Terraced house' },
    { postcode_area: null, kind: 'sale', raw_type: 'House' },
    { postcode_area: 'LE', kind: 'lease', raw_type: 'House' },
  ]);
  assert.deepEqual(s.byCell.get('LE|sale'), { house: 1, flat: 2 });
  assert.deepEqual(s.byCell.get('LE|rent'), { house: 1, flat: 0 });
  assert.equal(s.unknown.get('LE|sale'), 2);
});

test('mustHavesOf: the most common budget band and bedrooms, or the middle rent ceiling', () => {
  const sale = { kind: 'sale' as const, budgets: new Map([['200-350', 2], ['u200', 1]]), maxRents: [], bedrooms: new Map([[3, 2], [4, 1]]) };
  assert.equal(mustHavesOf(sale), '£200k–£350k · 3 bed');
  const rent = { kind: 'rent' as const, budgets: new Map(), maxRents: [2000, 2500, 3000], bedrooms: new Map([[4, 1]]) };
  assert.equal(mustHavesOf(rent), 'up to £2,500 pcm · 4+ bed');
  assert.equal(mustHavesOf({ kind: 'sale', budgets: new Map(), maxRents: [], bedrooms: new Map() }), null);
});

test('demandRows: a house row and a flat row per area × kind; "either" counts in both', () => {
  const d = buildDemand([member('a'), member('b'), member('c')], [profile('a', buyer('either'), ['LE']), profile('b', buyer('house'), ['LE']), profile('c', buyer('flat'), ['LE'])], OPTS);
  const rows = demandRows(inputs({ demand: d, live: supplyFrom([{ postcode_area: 'LE', kind: 'sale', raw_type: 'Semi-detached house' }]) }));
  const house = rows.find((r) => r.type === 'house')!;
  const flat = rows.find((r) => r.type === 'flat')!;
  assert.equal(rows.length, 2);
  assert.equal(house.members, 2, 'a (either) and b (house)');
  assert.equal(flat.members, 2, 'a (either) and c (flat)');
  assert.equal(house.liveDeals, 1);
  assert.equal(house.gap, 1);
  assert.equal(flat.gap, 2);
  assert.equal(house.status, 'demand');
  assert.equal(house.areaName, 'Leicester');
});

test('demandRows: every status an area × kind can be in', () => {
  const d = buildDemand(
    [member('a'), member('b')],
    [
      profile('a', buyer(null), ['LE', 'IV', 'ZE', 'BA', 'HG']),
      profile('b', buyer(null), ['LE', 'IV', 'ZE', 'BA']),
    ],
    OPTS,
  );
  const status = (rows: DemandRow[]) => Object.fromEntries(rows.filter((r) => r.type === 'house').map((r) => [r.area, r.status]));
  const base = { demand: d, sweepAreas: new Set(['BA', 'HG']), sweepDoneToday: new Set(['sale|BA|||']) };
  assert.deepEqual(status(demandRows(inputs(base))), { LE: 'demand', IV: 'demand', ZE: 'no_data', BA: 'sweep_today', HG: 'sweep_missed' });
  assert.equal(demandRows(inputs(base)).find((r) => r.area === 'IV')!.early, true);
  assert.equal(status(demandRows(inputs({ ...base, capReached: true }))).LE, 'cap_reached');
  const single = buildDemand([member('a')], [profile('a', buyer(null), ['LE'])], OPTS);
  assert.equal(status(demandRows(inputs({ demand: single }))).LE, 'below_threshold');
  assert.equal(status(demandRows(inputs({ ...base, gaveUpToday: new Set(['sale|LE|||']) }))).LE, 'demand', 'no answer twice today is still a demand area');
});

test('demandRows: areas nobody wants appear only when asked for, and empty rows never', () => {
  const d = buildDemand([], [], OPTS);
  const live = supplyFrom([{ postcode_area: 'YO', kind: 'sale', raw_type: 'Detached house' }]);
  assert.equal(demandRows(inputs({ demand: d, live })).length, 0);
  const all = demandRows(inputs({ demand: d, live, includeUnwanted: true, sweepAreas: new Set(['YO']) }));
  assert.equal(all.length, 1, 'the YO flat row has nothing in it and is left out');
  assert.deepEqual({ area: all[0].area, type: all[0].type, status: all[0].status, gap: all[0].gap }, { area: 'YO', type: 'house', status: 'sweep_missed', gap: -1 });
});

test('demandRows copes with no demand and no supply at all', () => {
  assert.deepEqual(demandRows(inputs({ demand: buildDemand([], [], OPTS), includeUnwanted: true })), []);
});

const row = (area: string, over: Partial<DemandRow> = {}): DemandRow => ({ area, areaName: area, kind: 'sale', type: 'house', members: 0, paying: 0, profiles: 0, liveDeals: 0, newDeals: 0, status: 'demand', early: false, gap: 0, mustHaves: null, ...over });

test('sortRows: by any column, ties broken by the biggest gap, then more profiles, then area', () => {
  const rows = [row('LE', { gap: 2, profiles: 3 }), row('BA', { gap: 5, profiles: 1 }), row('YO', { gap: 2, profiles: 4 }), row('CT', { gap: -1, status: 'sweep_today' })];
  assert.deepEqual(sortRows(rows, 'gap', 'desc').map((r) => r.area), ['BA', 'YO', 'LE', 'CT']);
  assert.deepEqual(sortRows(rows, 'area', 'asc').map((r) => r.area), ['BA', 'CT', 'LE', 'YO']);
  assert.deepEqual(sortRows(rows, 'profiles', 'desc').map((r) => r.area), ['YO', 'LE', 'BA', 'CT']);
  assert.deepEqual(sortRows(rows, 'status', 'asc').map((r) => r.area), ['BA', 'YO', 'LE', 'CT']);
  assert.equal(rows[0].area, 'LE', 'the input is left as it was');
});

test('sort keys and default directions', () => {
  assert.ok(isSortKey('gap'));
  assert.ok(!isSortKey('email'));
  assert.equal(defaultDir('area'), 'asc');
  assert.equal(defaultDir('gap'), 'desc');
});

test('planView: a cached answer costs nothing; only the first N are this pass', () => {
  const d = buildDemand([member('a'), member('b')], [profile('a', buyer(null), ['LE', 'IV']), profile('b', buyer(null), ['LE', 'IV'])], OPTS);
  const plan = inputs({ demand: d }).plan;
  const v = planView(plan, 2.2, new Set(['sale|IV|||']), 1);
  assert.deepEqual(
    v.wouldSearch.map((s) => [s.key, s.estPence, s.thisPass]),
    [
      ['sale|IV|||', 0, true],
      ['sale|LE|||', 2.2, false],
    ],
  );
});
