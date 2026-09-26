import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyKindFeedback,
  buildCandidate,
  dealKey,
  filtersForGoals,
  listingFromRow,
  nearestAreas,
  nearestOutside,
  orderForToday,
  parseStoredDeal,
  referencePoint,
  type CandidateContext,
  type PoolRow,
} from './candidates.ts';
import { rankForMember } from '../listing/rank.ts';
import { feedbackRules, type PickFeedback } from '../listing/picks.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_FILTERS, parseDealFilters } from '../marketplace/grid.ts';
import { dealsPathForGoals } from '../onboarding/deal-filters.ts';

const NOW = new Date('2026-09-26T09:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const purchase = (grossYieldPct: number) => ({ kind: 'purchase', grossYieldPct, targetYieldPct: 8, grossRevenue: 30_000, cashflowMonthly: 500 });

const row = (over: Partial<PoolRow> = {}): PoolRow => ({
  id: 'd1',
  source: 'rightmove',
  kind: 'sale',
  postcode_area: 'NG',
  outcode: 'NG7',
  town: 'Nottingham',
  bedrooms: 2,
  price_amount: 180_000,
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
  deal: purchase(9),
  suitability: 'ok',
  screening: { kind: 'purchase', band: 'qualified', upliftPct: 60, surplus: 12_000 },
  motivation: null,
  ...over,
});

const ctx = (over: Partial<CandidateContext> = {}): CandidateContext => ({
  goals: null,
  areaFit: () => 60,
  areaName: () => 'Nottingham',
  minPrice: null,
  maxPrice: null,
  now: NOW,
  ...over,
});

test('stored deal figures are only read when they carry what fit needs', () => {
  assert.equal(parseStoredDeal(purchase(9))?.kind, 'purchase');
  assert.equal(parseStoredDeal({ kind: 'rent-to-rent', monthlyMargin: 400, targetMarginPcm: 300 })?.kind, 'rent-to-rent');
  assert.equal(parseStoredDeal({ kind: 'purchase', grossYieldPct: 9 }), null, 'no target: no fit');
  assert.equal(parseStoredDeal(null), null);
  assert.equal(parseStoredDeal('nope'), null);
});

test('the listing handed to the rules carries no address, postcode or real URL', () => {
  const l = listingFromRow(row());
  assert.equal(l.canonicalUrl, dealKey('d1'));
  assert.ok(!l.canonicalUrl.startsWith('http'));
  assert.equal(l.address, null);
  assert.equal(l.postcode, null);
  assert.deepEqual(l.price, { amount: 180_000, period: 'total' });
  assert.equal(listingFromRow(row({ kind: 'rent', price_amount: 1_200, price_period: 'pcm' })).price?.period, 'pcm');
  assert.equal(listingFromRow(row({ price_amount: null })).price, null);
});

test('a row the ranking cannot use is left out', () => {
  assert.equal(buildCandidate(row({ deal: null }), ctx()), null);
  assert.equal(buildCandidate(row({ suitability: 'room' }), ctx()), null);
  assert.equal(buildCandidate(row({ suitability: 'unknown' }), ctx())?.candidate.precheck, 'unknown');
  assert.equal(buildCandidate(row(), ctx())?.candidate.precheck, 'ok');
});

test('price outside the member’s bounds is a soft failure, recorded for the near-miss advice', () => {
  const inside = buildCandidate(row(), ctx({ minPrice: 100_000, maxPrice: 200_000 }))!;
  assert.deepEqual(inside.fails, []);
  const over = buildCandidate(row({ price_amount: 260_000 }), ctx({ maxPrice: 200_000 }))!;
  assert.deepEqual(over.fails, ['price']);
  assert.equal(over.near.amount, 260_000);
});

test('"motivated sellers only" applies the member’s own time on market on top of the stored verdict', () => {
  const only: MarketGoals = { ...DEFAULT_GOALS, motivation: { mode: 'only', minMonthsOnMarket: 3, minWeeksOnMarket: 8, areaRelative: true } };
  const motivated = { score: 70, firmScore: 60, fired: ['long_on_market', 'price_reduced'] };
  const old = buildCandidate(row({ motivation: motivated, listed_date: daysAgo(200) }), ctx({ goals: only }))!;
  assert.deepEqual(old.fails, []);
  assert.equal(old.candidate.motivationQualifies, true);
  const young = buildCandidate(row({ motivation: motivated, listed_date: daysAgo(20) }), ctx({ goals: only }))!;
  assert.deepEqual(young.fails, ['motivation'], 'motivated but not on long enough for this member');
  const none = buildCandidate(row({ motivation: null, listed_date: daysAgo(200) }), ctx({ goals: only }))!;
  assert.deepEqual(none.fails, ['motivation'], 'no evidence is not a pass');
  // "Prefer" never excludes anything.
  const prefer = buildCandidate(row({ motivation: null }), ctx({ goals: { ...only, motivation: { ...only.motivation, mode: 'prefer' } } }))!;
  assert.deepEqual(prefer.fails, []);
});

test('the same feedback rules shape Today as shape the picks run', () => {
  const said: PickFeedback[] = [{ reaction: 'no', reactionSource: 'form', reasons: ['too_expensive'], kind: 'sale', postcodeArea: 'NG', bedrooms: 2, amount: 200_000, rawType: 'Terraced house' }];
  const rules = feedbackRules(said);
  const cheap = buildCandidate(row({ id: 'cheap', price_amount: 170_000 }), ctx())!.candidate;
  const dear = buildCandidate(row({ id: 'dear', price_amount: 190_000 }), ctx())!.candidate;
  const ranked = rankForMember([dear, cheap], said, rules, { depth: 40, mode: 'off' }).ranked;
  // "Too expensive" at £200k caps them at £180k.
  assert.deepEqual(ranked.map((c) => c.dealId), ['cheap']);
});

test('Today’s order: card-cleared first, then fit, then the higher profit', () => {
  const c = (dealId: string, fit: number, profit: number | null, precheck: 'ok' | 'unknown' = 'ok') => ({ dealId, fit, profit, precheck, screening: null });
  const ordered = orderForToday([c('a', 70, 5_000), c('b', 70, 9_000), c('u', 90, 20_000, 'unknown'), c('d', 80, 1_000), c('e', 70, null)]);
  assert.deepEqual(ordered.map((x) => x.dealId), ['d', 'b', 'a', 'e', 'u']);
});

test('Today reads the member’s goals exactly as /deals does from the welcome link', () => {
  const goals: MarketGoals = { ...DEFAULT_GOALS, sourcingKind: 'sale', budget: '200-350', home: { postcode: 'NG1 1AA', lat: 52.95, lng: -1.15 }, maxDistanceMiles: 25 };
  const viaWelcome = parseDealFilters(Object.fromEntries(new URL(`https://x${dealsPathForGoals(goals, ['DE'])}`).searchParams));
  assert.deepEqual(filtersForGoals(goals, ['DE']), viaWelcome);
  assert.equal(filtersForGoals(goals, []).kind, 'sale');
  assert.equal(filtersForGoals(goals, []).minPrice, 200_000);
  assert.equal(filtersForGoals(goals, []).maxPrice, 350_000);
  assert.deepEqual(filtersForGoals(null, []), DEFAULT_FILTERS, 'no goals: the whole pool');
});

test('a kind switch from feedback drops the other kind’s price bounds', () => {
  const sale = { ...DEFAULT_FILTERS, kind: 'sale' as const, minPrice: 200_000, maxPrice: 350_000 };
  assert.deepEqual(applyKindFeedback(sale, { wantKind: 'rent' }), { ...sale, kind: 'rent', minPrice: null, maxPrice: null });
  assert.equal(applyKindFeedback(sale, { wantKind: null }), sale);
  assert.equal(applyKindFeedback(sale, { wantKind: 'sale' }), sale);
  assert.equal(applyKindFeedback({ ...DEFAULT_FILTERS }, { wantKind: 'rent' }).kind, 'rent');
});

test('when the member’s areas hold nothing, the nearest deal outside them is offered', () => {
  const home = { lat: 52.95, lng: -1.15 }; // Nottingham
  const goals: MarketGoals = { ...DEFAULT_GOALS, home: { postcode: 'NG1 1AA', ...home } };
  assert.deepEqual(referencePoint(goals, ['M']), home, 'home wins over chosen areas');
  assert.ok(referencePoint(null, ['NG']) !== null);
  assert.equal(referencePoint(null, []), null);

  const near = nearestAreas(home, new Set(['NG']), 3);
  assert.equal(near.length, 3);
  assert.ok(!near.includes('NG'));
  assert.ok(near.includes('DE') || near.includes('LE'), `${near}`);

  const at = (dealId: string, area: string, fit: number) => ({ dealId, fit, listing: { postcodeArea: area } });
  const pick = nearestOutside([at('far', 'AB', 95), at('near', 'DE', 40), at('own', 'NG', 99)], home, new Set(['NG']));
  assert.equal(pick?.dealId, 'near');
  assert.equal(nearestOutside([at('x', 'DE', 50)], null, new Set()), null, 'no idea where they are: no guess');
});
