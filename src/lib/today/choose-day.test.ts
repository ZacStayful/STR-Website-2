import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseDay, inputForType, withoutKindFlips } from './choose-day.ts';
import type { ChooseInput, ChooseReads } from './choose.ts';
import type { PoolRow } from './candidates.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { dealTypeOf, typesShown, type DealType } from '../profile/deal-types.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import type { PickFeedback } from '../listing/picks.ts';

const NOW = new Date('2026-09-29T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const PROJECT = { v: 1, level: 'full', price: 90_000, bedrooms: 3, worksLow: 20_000, worksHigh: 30_000, value: 150_000, valueAdded: 30_000, valueAddedPct: 20, months: 4, cashLow: 60_000, cashHigh: 70_000 };

/** A live pool row of one type; a higher `profit` ranks first. */
function row(id: string, type: DealType, profit: number): PoolRow & { project?: unknown } {
  const sale = type !== 'r2r';
  return {
    id,
    source: 'rightmove',
    kind: sale ? 'sale' : 'rent',
    postcode_area: 'NG',
    outcode: 'NG1',
    town: 'Nottingham',
    bedrooms: 3,
    price_amount: sale ? 150_000 : 1_000,
    price_period: sale ? 'total' : 'pcm',
    raw_type: 'Terraced',
    tenure: 'Freehold',
    band: 'qualified',
    annual_profit: profit,
    uplift_pct: sale ? 50 : null,
    reduced_at: null,
    listed_date: daysAgo(30),
    status: 'live',
    first_seen_at: daysAgo(30),
    last_checked_live_at: null,
    last_confirmed_at: daysAgo(1),
    last_confirmed_via: 'live',
    live_since: daysAgo(10),
    deal: sale ? { kind: 'purchase', grossYieldPct: 12, targetYieldPct: 10, grossRevenue: 30_000, cashflowMonthly: 600 } : { kind: 'rent-to-rent', monthlyMargin: 800, targetMarginPcm: 500, grossRevenue: 30_000 },
    suitability: 'ok',
    screening: sale ? { kind: 'purchase', band: 'qualified', upliftPct: 50, surplus: 5_000 } : { kind: 'rent-to-rent', band: 'qualified', annualProfit: profit, surplus: profit },
    motivation: null,
    project: type === 'brrr' ? PROJECT : null,
  } as PoolRow & { project?: unknown };
}

function poolOf(counts: Partial<Record<DealType, number>>): (PoolRow & { project?: unknown })[] {
  const out: (PoolRow & { project?: unknown })[] = [];
  for (const [t, n] of Object.entries(counts) as [DealType, number][]) for (let i = 1; i <= n; i += 1) out.push(row(`${t}${i}`, t, 20_000 - i * 100));
  return out;
}

/** The reads as rankingPool answers them, the types filter included; every pool read recorded. */
function readsOf(rows: (PoolRow & { project?: unknown })[]): { reads: ChooseReads; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    reads: {
      pool: async (f, limit) => {
        seen.push(f.types.join('+') || 'all');
        return rows
          .filter((r) => (f.kind === 'both' || r.kind === f.kind) && (f.types.length === 0 || f.types.includes(dealTypeOf(r))))
          .sort((a, b) => (b.annual_profit ?? 0) - (a.annual_profit ?? 0))
          .slice(0, limit);
      },
      fullListings: async () => new Map<string, SourcedListing>(),
      dealTypes: async (ids) => new Map(ids.map((id) => [id, dealTypeOf(rows.find((r) => r.id === id)!)])),
    },
  };
}

const input = (types: DealType[] | undefined, over: Partial<ChooseInput> = {}, goals: Partial<MarketGoals> = {}): ChooseInput => ({
  goals: { ...DEFAULT_GOALS, ...goals },
  savedAreas: [],
  feedback: [],
  exclude: new Set(),
  cards: null,
  now: NOW,
  types,
  ...over,
});

const typesOf = (ids: string[]) => ids.map((id) => id.replace(/\d+$/, ''));

test('All three: Today starts 2 Buy and let / 2 Rent-to-rent / 1 BRRR, dealt round the types', async () => {
  const { reads, seen } = readsOf(poolOf({ buy_let: 6, brrr: 6, r2r: 6 }));
  const day = await chooseDay(input(['buy_let', 'brrr', 'r2r']), reads);
  assert.equal(day.dealIds.length, 5);
  const t = typesOf(day.dealIds);
  assert.deepEqual([t.filter((x) => x === 'buy_let').length, t.filter((x) => x === 'r2r').length, t.filter((x) => x === 'brrr').length], [2, 2, 1]);
  assert.deepEqual(seen, ['buy_let', 'brrr', 'r2r'], 'one pool read per type, each narrowed to it');
  assert.equal(day.nearMiss, false);
});

test('Buy and let only: never a rental or a Project deal, even on a short day', async () => {
  const { reads, seen } = readsOf(poolOf({ buy_let: 2, brrr: 6, r2r: 6 }));
  const day = await chooseDay(input(['buy_let']), reads);
  assert.deepEqual(day.dealIds, ['buy_let1', 'buy_let2']);
  assert.ok(seen.every((s) => s === 'buy_let'), 'no other type is ever read');
});

test('an empty slot goes to another chosen type, never an unchosen one', async () => {
  const { reads } = readsOf(poolOf({ buy_let: 6, r2r: 6, brrr: 0 }));
  const day = await chooseDay(input(['buy_let', 'brrr', 'r2r']), reads);
  assert.equal(day.dealIds.length, 5);
  assert.ok(!day.dealIds.some((id) => id.startsWith('brrr')));
  const onlyBrrr = await chooseDay(input(['brrr', 'r2r']), readsOf(poolOf({ buy_let: 6, brrr: 1, r2r: 1 })).reads);
  assert.deepEqual([...onlyBrrr.dealIds].sort(), ['brrr1', 'r2r1'], 'two types with one deal each: two cards, no Buy and let');
});

test('the mix shifts toward what the member keeps, but keeps one of each', async () => {
  const { reads } = readsOf(poolOf({ buy_let: 6, brrr: 6, r2r: 6 }));
  const day = await chooseDay(input(['buy_let', 'brrr', 'r2r'], { typeKeeps: { r2r: 6 } }), reads);
  const t = typesOf(day.dealIds);
  assert.deepEqual([t.filter((x) => x === 'buy_let').length, t.filter((x) => x === 'r2r').length, t.filter((x) => x === 'brrr').length], [1, 3, 1]);
});

test('no types: the whole pool, one list, exactly as before Batch 17', async () => {
  const { reads, seen } = readsOf(poolOf({ buy_let: 3, brrr: 3, r2r: 3 }));
  const day = await chooseDay(input(undefined), reads);
  assert.equal(day.dealIds.length, 5);
  assert.deepEqual(seen, ['all']);
});

test('a profile with no types yet is shown Buy and let + Rent-to-rent: never BRRR (Q22)', async () => {
  const types = typesShown({ goals: null, about: null });
  const day = await chooseDay(input(types), readsOf(poolOf({ buy_let: 6, brrr: 6, r2r: 6 })).reads);
  assert.equal(day.dealIds.length, 5);
  assert.ok(!day.dealIds.some((id) => id.startsWith('brrr')));
});

test('each type judged on its own money answer: BRRR on the project budget, before works', () => {
  const g = { ...DEFAULT_GOALS, budget: '500+' as const, brrr: { budget: 'u200' as const, work: null } };
  assert.equal(inputForType(input(['brrr'], {}, g), 'brrr').goals?.budget, 'u200');
  assert.equal(inputForType(input(['brrr'], {}, g), 'buy_let').goals?.budget, '500+');
  assert.equal(inputForType(input(['r2r'], {}, g), 'r2r').goals?.sourcingKind, 'rent');
});

test('"I want rent-to-rent, not to buy" never flips a type’s pool (it adds the type instead, Q25)', () => {
  const f: PickFeedback = { reaction: 'no', reactionSource: 'form', reasons: ['want_r2r', 'too_expensive'], kind: 'sale', postcodeArea: 'NG', bedrooms: 3, amount: 200_000, rawType: null };
  assert.deepEqual(withoutKindFlips([f])[0].reasons, ['too_expensive']);
});

test('re-choosing a mixed day keeps each type’s answered cards where they are', async () => {
  const rows = poolOf({ buy_let: 8, brrr: 4, r2r: 8 });
  const { reads } = readsOf(rows);
  const first = await chooseDay(input(['buy_let', 'brrr', 'r2r']), reads);
  const pinned = new Set([first.dealIds[0], first.dealIds[2]]);
  const again = await chooseDay(input(['buy_let', 'brrr', 'r2r'], { exclude: new Set(first.dealIds.filter((id) => !pinned.has(id))) }), reads, { current: first.dealIds, pinned });
  assert.equal(again.dealIds[0], first.dealIds[0]);
  assert.equal(again.dealIds[2], first.dealIds[2]);
  assert.equal(new Set(again.dealIds).size, again.dealIds.length);
});
