import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTailored, mustMatchCount, mustMissAdvice, tailoredOrder } from './today.ts';
import { plainProfile, type TailoringProfile } from './profile.ts';
import type { ChooseInput, ChooseReads } from '../today/choose.ts';
import type { PoolRow } from '../today/candidates.ts';
import type { PickFeedback } from '../listing/picks.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT } from '../profile/about.ts';
import type { Judgement } from './criteria.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };

const row = (id: string, over: Partial<PoolRow> = {}): PoolRow => ({
  id,
  source: 'rightmove',
  kind: 'sale',
  postcode_area: 'NG',
  outcode: 'NG7',
  town: 'Nottingham',
  bedrooms: 3,
  price_amount: 150_000,
  price_period: 'total',
  raw_type: 'Terraced house',
  tenure: 'Freehold',
  band: 'qualified',
  annual_profit: 12_000,
  uplift_pct: 60,
  reduced_at: null,
  listed_date: daysAgo(30),
  status: 'live',
  first_seen_at: daysAgo(30),
  last_checked_live_at: null,
  last_confirmed_at: daysAgo(1),
  last_confirmed_via: 'live',
  live_since: daysAgo(10),
  deal: { kind: 'purchase', grossYieldPct: 12, targetYieldPct: 10, grossRevenue: 30_000, cashflowMonthly: 500 },
  suitability: 'ok',
  screening: { kind: 'purchase', band: 'qualified', upliftPct: 60, surplus: 12_000 },
  screening_gross: 30_000,
  screening_confidence: 'medium',
  motivation: null,
  ...over,
});

const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over });
const profile = (g: Partial<MarketGoals>, over: Partial<TailoringProfile> = {}) => plainProfile(goals(g), [], WIDTHS, { answered: { deals_done: real }, ...over });

interface Setup {
  rows: PoolRow[];
  snapshots?: Map<string, SourcedListing>;
  feedback?: PickFeedback[];
  exclude?: Set<string>;
}
function world(s: Setup) {
  const reads: ChooseReads = {
    pool: async (f, limit) => s.rows.filter((r) => f.kind === 'both' || r.kind === f.kind).slice(0, limit),
    fullListings: async (ids) => new Map(ids.flatMap((id) => (s.snapshots?.has(id) ? [[id, s.snapshots.get(id)!] as const] : []))),
  };
  const input = (p: TailoringProfile): ChooseInput => ({ goals: p.goals, savedAreas: p.savedAreas, feedback: s.feedback ?? [], exclude: s.exclude ?? new Set(), cards: null, now: NOW, tailoring: p });
  return { reads, input };
}

test('a must-have takes a deal off the list; switched to nice-to-have it comes back, lower down', async () => {
  const w = world({ rows: [row('cheap', { price_amount: 150_000, annual_profit: 9_000 }), row('dear', { price_amount: 260_000, annual_profit: 20_000 })] });
  const must = profile({ budget: 'u200' });
  const a = await chooseTailored(w.input(must), must, w.reads);
  assert.deepEqual(a.dealIds, ['cheap']);
  assert.equal(a.mustMatches, 1);
  const nice = profile({ budget: 'u200' }, { modes: { budget: 'nice' } });
  const b = await chooseTailored(w.input(nice), nice, w.reads);
  assert.deepEqual(b.dealIds, ['cheap', 'dear'], 'the miss goes below the match despite the higher profit');
  assert.equal(b.mustMatches, 2);
});

test('a deal that cannot be judged on a must-have is shown, not removed', async () => {
  const w = world({ rows: [row('no-price', { price_amount: null }), row('over', { price_amount: 400_000 })] });
  const p = profile({ budget: 'u200' });
  const r = await chooseTailored(w.input(p), p, w.reads);
  assert.deepEqual(r.dealIds, ['no-price']);
});

test('each kind is judged by its own answers: a "both" member keeps rentals under a purchase budget', async () => {
  const w = world({
    rows: [
      row('sale-over', { price_amount: 300_000 }),
      row('let', { kind: 'rent', price_amount: 1_100, price_period: 'pcm', deal: { kind: 'rent-to-rent', monthlyMargin: 700, targetMarginPcm: 500 }, screening: { kind: 'rent-to-rent', band: 'qualified', annualProfit: 8_000, surplus: 8_000 } }),
    ],
  });
  const p = profile({ sourcingKind: 'both', budget: 'u200' });
  assert.deepEqual((await chooseTailored(w.input(p), p, w.reads)).dealIds, ['let']);
});

test('nice-to-haves order the list: fewest missed first, then most met, before fit and profit', async () => {
  const w = world({
    rows: [
      row('two-bed', { bedrooms: 2, annual_profit: 30_000 }),
      row('three-bed', { bedrooms: 3, annual_profit: 5_000 }),
      row('unknown-beds', { bedrooms: null, annual_profit: 20_000 }),
    ],
  });
  const p = profile({ bedrooms: 3 });
  assert.deepEqual((await chooseTailored(w.input(p), p, w.reads)).dealIds, ['three-bed', 'unknown-beds', 'two-bed'], 'an unknown is neither a miss nor a meet');
});

test('the whole pool is ranked: the best match is found even far down the fit order', async () => {
  // 60 deals; the only 2-bed has the weakest figures of all.
  const rows = Array.from({ length: 60 }, (_, i) => row(`d${String(i).padStart(2, '0')}`, { bedrooms: 3, annual_profit: 50_000 - i * 100, deal: { kind: 'purchase', grossYieldPct: 20 - i * 0.2, targetYieldPct: 10, grossRevenue: 30_000, cashflowMonthly: 500 } }));
  rows.push(row('weak-two-bed', { bedrooms: 2, annual_profit: 100, deal: { kind: 'purchase', grossYieldPct: 3, targetYieldPct: 10, grossRevenue: 30_000, cashflowMonthly: 10 } }));
  const w = world({ rows });
  const p = profile({ bedrooms: 2 });
  assert.equal((await chooseTailored(w.input(p), p, w.reads)).dealIds[0], 'weak-two-bed');
});

test('the full listing is checked a batch at a time until the day is full', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => row(`d${String(i).padStart(2, '0')}`, { annual_profit: 50_000 - i }));
  const work = new Map<string, SourcedListing>();
  // The best 42 all turn out to need work once the full listing is read.
  for (const r of rows.slice(0, 42)) work.set(r.id, { source: 'rightmove', id: r.id, canonicalUrl: 'x', kind: 'sale', title: 'Needs modernisation throughout', address: null, postcode: null, outcode: 'NG7', postcodeArea: 'NG', lat: null, lng: null, bedrooms: 3, bathrooms: null, price: { amount: 150_000, period: 'total' }, rawType: 'Terraced house', photo: null });
  const said: PickFeedback[] = [{ reaction: 'no', reactionSource: 'form', reasons: ['needs_work'], kind: 'sale', postcodeArea: 'NG', bedrooms: 3, amount: 150_000, rawType: 'Terraced house', outcode: 'NG7' }];
  const w = world({ rows, snapshots: work, feedback: said });
  const p = profile({});
  assert.deepEqual((await chooseTailored(w.input(p), p, w.reads)).dealIds, ['d42', 'd43', 'd44']);
});

test('nothing meets the must-haves: the closest, saying what it misses', async () => {
  const w = world({ rows: [row('far-over', { price_amount: 450_000 }), row('just-over', { price_amount: 210_000, postcode_area: 'NG' })] });
  const p = profile({ budget: 'u200', where: 'areas' }, { savedAreas: ['LS'] });
  const r = await chooseTailored(w.input(p), p, w.reads);
  assert.equal(r.nearMiss, true);
  assert.equal(r.dealIds.length, 1);
  assert.equal(r.mustMatches, 0);
  assert.match(r.advice ?? '', /Nothing met all your must-haves today/);
  assert.equal(mustMissAdvice(['budget']), 'Nothing met all your must-haves today. This is the closest: it is outside your budget. You can widen your search or make one of them a nice-to-have.');
  assert.match(mustMissAdvice(['location', 'budget']), /outside where you look and it is outside your budget/);
  const empty = await chooseTailored(world({ rows: [] }).input(p), p, world({ rows: [] }).reads);
  assert.deepEqual(empty, { dealIds: [], nearMiss: false, advice: null, mustMatches: 0, capped: false });
});

test('re-choosing keeps what still fits and what was answered, in place, and replaces the rest', async () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => row(id, { price_amount: id === 'b' || id === 'c' ? 300_000 : 150_000, annual_profit: 20_000 - i * 1_000 }));
  const current = ['a', 'b', 'c', 'd', 'e'];
  const answered = new Set(['c']);
  // c is answered, so it is excluded from new picks but stays; f and g are new.
  const w = world({ rows, exclude: answered });
  const p = profile({ budget: 'u200' });
  const r = await chooseTailored(w.input(p), p, w.reads, { current, pinned: answered });
  assert.deepEqual(r.dealIds, ['a', 'f', 'c', 'd', 'e']);
  // Flipping back and forth settles on the same list.
  const again = await chooseTailored(w.input(p), p, w.reads, { current: r.dealIds, pinned: answered });
  assert.deepEqual(again.dealIds, r.dealIds);
});

test('the tailored order is stable and never depends on the order rows arrive in', () => {
  const judged = new Map<string, Judgement>([
    ['x', { checks: [], mustFails: [], mustUnknown: [], niceMissed: 0, met: 2, unknown: 0, checked: 2 }],
    ['y', { checks: [], mustFails: [], mustUnknown: [], niceMissed: 0, met: 2, unknown: 0, checked: 2 }],
  ]);
  const c = (dealId: string) => ({ dealId, fit: 50, profit: 1_000, precheck: 'ok' as const, screening: null, listing: {} as SourcedListing, deal: null, areaFit: 50, areaName: 'x' });
  assert.deepEqual(tailoredOrder([c('y'), c('x')], judged).map((x) => x.dealId), ['x', 'y']);
  assert.deepEqual(tailoredOrder([c('x'), c('y')], judged).map((x) => x.dealId), ['x', 'y']);
  assert.deepEqual(tailoredOrder([c('x'), c('y')], judged, new Map([['y', 5]])).map((x) => x.dealId), ['y', 'x'], 'fit for you counts');
});

test('the must-have count is the whole visible pool, shown deals included', () => {
  const p = profile({ budget: 'u200' });
  assert.equal(mustMatchCount([row('a'), row('b', { price_amount: 300_000 }), row('c', { price_amount: null })], p, NOW), 2);
});

test('near me + the best elsewhere: three local, two from anywhere, each filling from the other', async () => {
  const home = { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 };
  const p = profile({ where: 'near_plus_best', home, maxDistanceMiles: 10 });
  const local = ['l1', 'l2', 'l3', 'l4'].map((id, i) => row(id, { postcode_area: 'NG', annual_profit: 1_000 - i }));
  const far = ['n1', 'n2', 'n3'].map((id, i) => row(id, { postcode_area: 'M', annual_profit: 20_000 - i }));
  const w = world({ rows: [...local, ...far] });
  const r = await chooseTailored(w.input(p), p, w.reads);
  assert.deepEqual([...r.dealIds].sort(), ['l1', 'l2', 'l3', 'n1', 'n2']);
  // Only one national deal: the local group fills the gap.
  const thin = world({ rows: [...local, far[0]] });
  assert.deepEqual([...(await chooseTailored(thin.input(p), p, thin.reads)).dealIds].sort(), ['l1', 'l2', 'l3', 'l4', 'n1']);
});

test('a beginner’s day keeps projects back unless nothing else fills it', async () => {
  const rows = ['a', 'b', 'c'].map((id, i) => row(id, { annual_profit: 3_000 - i }));
  const snap = (id: string, title: string): SourcedListing => ({ source: 'rightmove', id, canonicalUrl: 'x', kind: 'sale', title, address: null, postcode: null, outcode: 'NG7', postcodeArea: 'NG', lat: null, lng: null, bedrooms: 3, bathrooms: null, price: { amount: 150_000, period: 'total' }, rawType: 'Terraced house', photo: null });
  const w = world({ rows, snapshots: new Map([['a', snap('a', 'Renovation project')], ['b', snap('b', 'Lovely home')], ['c', snap('c', 'Lovely home')]]) });
  const beginner = profile({}, { about: { ...DEFAULT_ABOUT, dealsDone: '0' } });
  assert.deepEqual((await chooseTailored(w.input(beginner), beginner, w.reads)).dealIds, ['b', 'c', 'a']);
  const bold = profile({}, { about: { ...DEFAULT_ABOUT, dealsDone: '0', risk: 'go' } });
  assert.deepEqual((await chooseTailored(w.input(bold), bold, w.reads)).dealIds, ['a', 'b', 'c']);
});
