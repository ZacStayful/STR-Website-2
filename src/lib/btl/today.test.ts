import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDeal } from './deal.ts';
import { growthRange } from './growth.ts';
import { rentRangeFor } from './rent.ts';
import { buildBtlCard, type BtlCard } from './card.ts';
import type { Benchmark } from './benchmark.ts';
import { benchmarkFromRow } from './benchmark.ts';
import { btlDistanceLabel, btlMargin, btlStrength, btlWidenFor, btlWidenLine, centreAreaOf, chooseBtlDay, parseBtlWiden, regionPhrase, widenSteps, type BtlReads } from './today.ts';
import { AREA_META } from '../market/areas.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import type { DealFilters } from '../marketplace/grid.ts';
import type { PoolRow } from '../today/candidates.ts';
import { chooseDay } from '../today/choose-day.ts';
import { parseStoredChoice } from '../today/choice.ts';
import { filtersForType } from '../today/type-filters.ts';

function card(over: Partial<BtlCard> = {}): BtlCard {
  const rent = rentRangeFor({ bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: 52.54, lng: -1.86, districtRentPcm: 1_155.64, districtYieldPct: 6.2 }, [])!;
  const deal = btlDeal(160_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: null })!;
  const growth = growthRange(160_000, 28.9, 3.9, 'B44', '2026-09-27');
  return { ...buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 3, kind: 'house', country: 'england', outcode: 'B44', region: 'west_midlands', rent, deal, growth, rateDate: 'Sep 2026', band: '50k_100k', serviceChargeConfirmed: null, epc: null, shortLease: false }), ...over };
}
const B44 = card();
const row = (id: string, area: string, c: BtlCard | null = B44): PoolRow => ({ id, kind: 'sale', band: 'unqualified', btl_pass: c !== null, btl: c, postcode_area: area }) as unknown as PoolRow;
const bm = (roiMedianPct: number, growthMedianPct: number | null = 2, over: Partial<Benchmark> = {}): Benchmark => ({ band: '50k_100k', step: '25mi', radiusMiles: 25, count: 40, steps: [], roiMedianPct, roiP40Pct: roiMedianPct - 1, growthMedianPct, growthP40Pct: growthMedianPct, thin: false, none: false, ...over });
const goals = (btl: MarketGoals['btl'], over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, dealTypes: ['btl'], where: 'areas', btl, ...over });

/** A pool that answers by area, and records what it was asked. */
function poolOf(rows: PoolRow[]) {
  const asked: DealFilters[] = [];
  const pool = async (f: DealFilters, limit: number) => {
    asked.push(f);
    return rows.filter((r) => f.areas.length === 0 || f.areas.includes(r.postcode_area ?? '')).slice(0, limit);
  };
  return { pool, asked };
}

test('where a member searches from: their home’s area, else the one of theirs nearest the middle', () => {
  assert.equal(centreAreaOf({ ...DEFAULT_GOALS, home: { postcode: 'LS1 4AP', lat: 53.8, lng: -1.55 } }, ['B']), 'LS');
  assert.equal(centreAreaOf(DEFAULT_GOALS, ['LS']), 'LS');
  assert.equal(centreAreaOf(DEFAULT_GOALS, []), null);
});

test('widening steps: 10, 25, 50 miles, the region, then the UK, each area once and never their own', () => {
  const steps = widenSteps('LS', ['LS'], [10, 25, 50]);
  const keys = steps.map((s) => (s.found.scope === 'miles' ? `${s.found.miles}mi` : s.found.scope));
  assert.deepEqual(keys.slice(-2), ['region', 'national']);
  assert.ok(keys.includes('25mi') && keys.includes('50mi'));
  const all = steps.flatMap((s) => s.areas);
  assert.equal(new Set(all).size, all.length, 'no area twice');
  assert.ok(!all.includes('LS'));
  assert.equal(all.length, AREA_META.length - 1, 'every other area somewhere');
  const region = steps.find((s) => s.found.scope === 'region')!;
  assert.deepEqual(region.found, { scope: 'region', region: 'Yorkshire & the Humber' });
  assert.ok(!region.areas.includes('M'), 'Manchester is the North West');
  assert.equal(regionPhrase('North West'), 'the North West');
  assert.equal(regionPhrase('Wales'), 'Wales');
});

test('only passing, in-budget buy-to-let deals, best margin over the benchmark first; never a row without the lens', async () => {
  const better = card({ roiPct: { low: 8, mid: 12, high: 14 } });
  const failsRent = card({ rentTest: { ...B44.rentTest, pass: false }, floorsOk: false });
  const pricey = card({ cashIn: { low: 100_000, mid: 105_000, high: 110_000 } });
  const below = card({ roiPct: { low: 1, mid: 3, high: 5 } });
  const { pool } = poolOf([row('a', 'B'), row('b', 'B', better), row('c', 'B', failsRent), row('d', 'B', pricey), row('e', 'B', below), row('f', 'B', null), row('x', 'B')]);
  const reads: BtlReads = { pool, benchmark: async () => bm(5) };
  const day = await chooseBtlDay({ goals: goals({ priority: 'income', cashBand: '50k_100k' }), savedAreas: ['B'], feedback: [], exclude: new Set(['x']) }, reads);
  assert.deepEqual(day.dealIds.slice(0, 2), ['b', 'a'], '12% then 9.7% against a 5% median');
  for (const id of ['c', 'd', 'e', 'f', 'x']) assert.ok(!day.dealIds.includes(id), id);
  assert.equal(day.ownMatches, 2);
  assert.equal(day.from, 'Birmingham');
  assert.equal(btlStrength(day.picks[0].margin), btlStrength(7));
  // Growth judges on growth: B44's 3.9% a year against a 4.5% median fails.
  const growth = await chooseBtlDay({ goals: goals({ priority: 'growth', cashBand: '50k_100k' }), savedAreas: ['B'], feedback: [], exclude: new Set() }, { pool, benchmark: async () => bm(5, 4.5) });
  assert.equal(growth.ownMatches, 0);
});

test('short of a full day in their own areas, it widens outward, and says how far for the deals it shows', async () => {
  const { pool, asked } = poolOf([row('own', 'LS'), row('near', 'BD'), row('far', 'B')]);
  const day = await chooseBtlDay({ goals: goals({ priority: 'income', cashBand: null }), savedAreas: ['LS'], feedback: [], exclude: new Set() }, { pool, benchmark: async () => bm(5) });
  assert.deepEqual(day.dealIds, ['own', 'near', 'far'], 'their own first, then outward');
  assert.ok(asked.every((f) => f.minPrice === null && f.maxPrice === null && f.minProfit === null), 'no short-let budget or profit filter');
  assert.equal(day.picks.find((p) => p.dealId === 'near')!.found.scope, 'miles');
  assert.equal(day.picks.find((p) => p.dealId === 'far')!.found.scope, 'national');
  assert.equal(btlWidenFor(day, ['own']), null, 'nothing beyond their areas shown: no line');
  const w = btlWidenFor(day, ['own', 'near'])!;
  assert.match(btlWidenLine(w), /^Not enough buy-to-let deals in Leeds today, so I looked up to \d+ miles out\.$/);
  assert.equal(btlWidenLine(btlWidenFor(day, ['far'])!), 'Not enough buy-to-let deals in Leeds today, so I looked across the UK.');
  assert.deepEqual(parseBtlWiden(JSON.parse(JSON.stringify(w))), w);
  assert.equal(parseBtlWiden({ from: 'Leeds', found: { scope: 'moon' } }), null);
  assert.equal(btlDistanceLabel(day.picks.find((p) => p.dealId === 'near')!.miles, day.from), `${day.picks.find((p) => p.dealId === 'near')!.miles} miles from Leeds`);
  // A full day at home: no widening read at all.
  const full = poolOf(['1', '2', '3', '4', '5'].map((id) => row(id, 'LS')));
  await chooseBtlDay({ goals: goals({ priority: 'income', cashBand: null }), savedAreas: ['LS'], feedback: [], exclude: new Set() }, { pool: full.pool, benchmark: async () => bm(5) });
  assert.equal(full.asked.length, 1);
});

test('the benchmark row round-trips; with none to compare, the hard rules alone decide', async () => {
  const stored = { band: '25k_50k', step: 'national', radius_miles: null, deal_count: 26, roi_median: 10.2, roi_p40: 9.9, growth_median: 2.37, growth_p40: 2.33, thin: true, no_compare: false, steps: [{ key: '10mi', radiusMiles: 10, count: 1 }] };
  const b = benchmarkFromRow(stored)!;
  assert.equal(b.roiMedianPct, 10.2);
  assert.equal(b.steps[0].key, '10mi');
  assert.equal(benchmarkFromRow({ ...stored, band: 'x' }), null);
  const { pool } = poolOf([row('a', 'B')]);
  const day = await chooseBtlDay({ goals: goals({ priority: 'income', cashBand: '50k_100k' }), savedAreas: ['B'], feedback: [], exclude: new Set() }, { pool, benchmark: async () => null });
  assert.deepEqual(day.dealIds, ['a']);
  assert.equal(btlMargin('both', { ...B44, growth: null }, bm(1)), Number.NEGATIVE_INFINITY);
});

test('Today: a Buy to let profile’s day is its buy-to-let deals, with the line stored; a three-type day never reads Buy to let', async () => {
  const rows = [row('own', 'LS'), row('near', 'BD')];
  const asked: DealFilters[] = [];
  const reads = {
    pool: async (f: DealFilters) => {
      asked.push(f);
      return f.types.includes('btl') ? rows.filter((r) => f.areas.length === 0 || f.areas.includes(r.postcode_area ?? '')) : [];
    },
    fullListings: async () => new Map(),
    btlBenchmark: async () => bm(5),
  };
  const base = { savedAreas: ['LS'], feedback: [], exclude: new Set<string>(), cards: null, now: new Date('2026-10-16T08:00:00Z') };
  const g = goals({ priority: 'income', cashBand: null });
  const only = await chooseDay({ ...base, goals: g, types: ['btl'] }, reads);
  assert.deepEqual(only.dealIds, ['own', 'near']);
  assert.ok(only.btlWiden && only.btlWiden.found.scope === 'miles');
  assert.ok(asked.every((f) => f.types.length === 1 && f.types[0] === 'btl'));
  const stored = parseStoredChoice({ checked: 2, meeting: null, capped: false, nearby: false, finds: 0, fp: null, answeredAt: null, btlWiden: only.btlWiden });
  assert.deepEqual(stored?.btlWiden, only.btlWiden);

  asked.length = 0;
  const mixed = await chooseDay({ ...base, goals: { ...g, dealTypes: ['buy_str', 'btl'] }, types: ['buy_str', 'btl'] }, reads);
  assert.deepEqual(mixed.dealIds, ['own', 'near'], 'no short-let deals today: the spare slots go to Buy to let, the other chosen type');

  asked.length = 0;
  const three = await chooseDay({ ...base, goals: { ...g, dealTypes: ['buy_str', 'brrr', 'r2r'] }, types: ['buy_str', 'brrr', 'r2r'] }, reads);
  assert.deepEqual(three.dealIds, []);
  assert.ok(asked.every((f) => !f.types.includes('btl')), 'a profile without Buy to let never reads it');
  assert.equal(three.btlWiden ?? null, null);
});

test('a buy-to-let search has no price band: its cash band is judged on the card', () => {
  const g = goals({ priority: 'income', cashBand: '25k_50k' }, { budget: '200-350', dealTypes: ['buy_str', 'btl'] });
  const f = filtersForType(g, ['LS'], 'btl');
  assert.deepEqual([f.kind, f.types, f.minPrice, f.maxPrice], ['sale', ['btl'], null, null]);
  assert.notEqual(filtersForType(g, ['LS'], 'buy_str').maxPrice, null, 'Short-let keeps its budget');
});
