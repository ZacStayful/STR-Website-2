import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustmentsFor, areaLookup, bonusOf, compareKeys, leaningsFor, likeness, operationsMiles, type AreaFacts, type Leanings, type OrderKey } from './order.ts';
import { memberFigures, type DealFacts } from './criteria.ts';
import { plainProfile, type Signal } from './profile.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';
import { DEFAULT_ABOUT } from '../profile/about.ts';
import type { AreaCardData } from '../market/explorer.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };

const facts = (over: Partial<DealFacts> = {}): DealFacts => ({
  kind: 'sale',
  area: 'NG',
  bedrooms: 3,
  amount: 150_000,
  propertyKind: 'house',
  tenure: 'freehold',
  licensing: 'confirmed-unrestricted',
  grossRevenue: 32_000,
  confidence: 'medium',
  deal: null,
  motivationQualifies: undefined,
  motivationScore: 0,
  needsWork: false,
  ...over,
});
const none: Leanings = { mainGoal: null, steady: false, bold: false, operations: [], manager: false, sourcer: false, feeRoom: null, signals: [] };
const lean = (over: Partial<Leanings>): Leanings => ({ ...none, ...over });
const fig = (f: DealFacts) => memberFigures(f, plainProfile(DEFAULT_GOALS, [], WIDTHS));
const noArea: AreaFacts = { growth5y: null, typicalValue: null };
const pts = (f: DealFacts, l: Leanings, area = noArea) => Object.fromEntries(adjustmentsFor(f, fig(f), l, area).map((a) => [a.key, a.points]));

test('no leanings, no adjustments: an untouched profile keeps the shared fit', () => {
  assert.deepEqual(adjustmentsFor(facts(), fig(facts()), none, noArea), []);
  assert.equal(bonusOf([]), 0);
});

test('a cash-flow buyer: cash-on-cash and monthly cash flow at their figures lift a deal, capped at 10', () => {
  const strong = pts(facts({ amount: 90_000, grossRevenue: 40_000 }), lean({ mainGoal: 'cashflow' })).cashflow;
  const weak = pts(facts({ amount: 250_000, grossRevenue: 22_000 }), lean({ mainGoal: 'cashflow' })).cashflow;
  assert.ok(strong > 0 && strong <= 10);
  assert.equal(weak ?? 0, 0, 'a deal that loses money is never lifted for it');
  assert.equal(pts(facts({ kind: 'rent', amount: 900 }), lean({ mainGoal: 'cashflow' })).cashflow, undefined, 'the buying goal does not judge a rental');
});

test('a growth buyer: rising area prices and a price below the typical one for the size', () => {
  const a = adjustmentsFor(facts({ amount: 150_000 }), fig(facts()), lean({ mainGoal: 'growth' }), { growth5y: 20, typicalValue: 200_000 });
  assert.equal(a[0].key, 'growth');
  assert.equal(a[0].points, 10);
  assert.equal(a[0].reason, 'below the area’s typical price for its size');
  const both = pts(facts({ amount: 150_000 }), lean({ mainGoal: 'both' }), { growth5y: 20, typicalValue: 200_000 });
  assert.equal(both.growth, 5, '"both" weighs each goal by half');
});

test('cautious members and beginners: steadier figures up, projects down, unless they said go for it', () => {
  assert.equal(pts(facts({ confidence: 'medium' }), lean({ steady: true })).steady, 5);
  assert.equal(pts(facts({ confidence: 'low', needsWork: true }), lean({ steady: true })).steady, -10);
  assert.equal(pts(facts({ confidence: 'low', needsWork: true }), lean({ steady: true, bold: true })).steady, undefined);
  const rental = facts({ kind: 'rent', amount: 900, confidence: 'low', deal: { kind: 'rent-to-rent', setupCost: 8_000, breakevenOccupancyPct: 45, paybackMonths: 12, monthlyMargin: 700 } as never });
  assert.equal(pts(rental, lean({ steady: true })).steady, 5, 'a low break-even');
  assert.equal(pts(facts({ motivationScore: 70 }), lean({ bold: true })).bold, 7);
});

test('near their operations: full points close by, fading to none at 40 miles; management companies count 1.5 times', () => {
  assert.equal(operationsMiles('NG', ['NG']), 0);
  assert.equal(pts(facts({ area: 'NG' }), lean({ operations: ['NG'] })).operations, 10);
  const derby = operationsMiles('DE', ['NG'])!; // about 20 miles
  assert.ok(derby > 10 && derby < 40);
  const owner = pts(facts({ area: 'DE' }), lean({ operations: ['NG'] })).operations;
  const manager = pts(facts({ area: 'DE' }), lean({ operations: ['NG'], manager: true })).operations;
  assert.ok(manager > owner);
  assert.equal(pts(facts({ area: 'M' }), lean({ operations: ['NG'] })).operations, undefined);
});

test('deal sourcers: room under the typical value that covers their fee, and motivated sellers', () => {
  const a = adjustmentsFor(facts({ amount: 162_000, bedrooms: 3, motivationScore: 30 }), fig(facts()), lean({ sourcer: true, feeRoom: 4_000 }), { growth5y: null, typicalValue: 200_000 });
  assert.equal(a[0].key, 'sourcer');
  assert.equal(a[0].points, 8);
  assert.equal(a[0].reason, '£38k under the area’s typical 3-bed');
});

test('similar to what they liked: 3 points a shared attribute, at most 10', () => {
  const liked: Signal = { dealId: 'k', source: 'keep', at: AT, kind: 'sale', propertyKind: 'house', bedrooms: 3, area: 'NG', amount: 160_000 };
  assert.equal(likeness(facts(), [liked]), 5);
  assert.equal(pts(facts(), lean({ signals: [liked] })).similar, 10);
  assert.equal(likeness(facts({ kind: 'rent', propertyKind: 'flat', bedrooms: 1, area: 'M', amount: 800 }), [liked]), 0);
});

test('every adjustment together is capped at 30', () => {
  const lots = [{ key: 'cashflow' as const, points: 10, reason: '' }, { key: 'operations' as const, points: 10, reason: '' }, { key: 'similar' as const, points: 10, reason: '' }, { key: 'bold' as const, points: 10, reason: '' }];
  assert.equal(bonusOf(lots), 30);
  assert.equal(bonusOf(lots.map((a) => ({ ...a, points: -10 }))), -30);
});

test('the order: short-let check, band, missed, met, fit for you, profit, id', () => {
  const k = (over: Partial<OrderKey>): OrderKey => ({ precheckOk: true, band: 0, niceMissed: 0, met: 0, fit: 50, profit: 1_000, id: 'a', ...over });
  const sorted = (xs: OrderKey[]) => [...xs].sort(compareKeys).map((x) => x.id);
  assert.deepEqual(sorted([k({ id: 'b', precheckOk: false, met: 9 }), k({ id: 'a' })]), ['a', 'b']);
  assert.deepEqual(sorted([k({ id: 'b', niceMissed: 1, fit: 99 }), k({ id: 'a', fit: 1 })]), ['a', 'b']);
  assert.deepEqual(sorted([k({ id: 'b', met: 1 }), k({ id: 'a', met: 2 })]), ['a', 'b']);
  assert.deepEqual(sorted([k({ id: 'b', fit: 40 }), k({ id: 'a', fit: 60 })]), ['a', 'b']);
  assert.deepEqual(sorted([k({ id: 'b', profit: null }), k({ id: 'a', profit: 5 })]), ['a', 'b']);
  assert.deepEqual(sorted([k({ id: 'b' }), k({ id: 'a' })]), ['a', 'b']);
});

test('what a profile leans towards comes from its answers, only where they are asked', () => {
  const buyer = plainProfile({ ...DEFAULT_GOALS, path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, mainGoal: 'growth' } }, [], WIDTHS, { about: { ...DEFAULT_ABOUT, dealsDone: '0', unitsNow: '1-2', unitAreas: ['LS'] }, answered: { main_goal: real } });
  const l = leaningsFor(buyer);
  assert.equal(l.mainGoal, 'growth');
  assert.equal(l.steady, true);
  assert.deepEqual(l.operations, ['LS']);
  const r2r = plainProfile({ ...DEFAULT_GOALS, path: 'r2r', buyer: { ...DEFAULT_GOALS.buyer, mainGoal: 'growth' } }, [], WIDTHS);
  assert.equal(leaningsFor(r2r).mainGoal, null);
  const card = { code: 'NG', byBedrooms: [{ bedrooms: 3, propertyValueMid: 210_000 }, { bedrooms: 5, propertyValueMid: 400_000 }], keyStats: { growth5y: 12 } } as unknown as AreaCardData;
  const look = areaLookup([card]);
  assert.deepEqual(look('NG', 3), { growth5y: 12, typicalValue: 210_000, competition: null, occupancy: null });
  assert.deepEqual(look('NG', 4), { growth5y: 12, typicalValue: 400_000, competition: null, occupancy: null }, '"4 or more" reads the nearest bigger group');
  assert.deepEqual(look('M', 3), { growth5y: null, typicalValue: null });
  assert.deepEqual(areaLookup(null)('NG', 3), { growth5y: null, typicalValue: null });
});

test('Batch 16: a deal shown on its own comparables check is lifted by the check’s confidence, whatever the leanings', () => {
  assert.deepEqual(pts(facts({ confidence: 'high', compCount: 12 }), none), { checked: 5 });
  assert.deepEqual(pts(facts({ confidence: 'medium', compCount: 9 }), none), { checked: 3 });
  assert.deepEqual(pts(facts({ confidence: 'low', compCount: 6 }), none), {}, 'a low-confidence check earns nothing: its wide range already says so');
  assert.deepEqual(pts(facts({ confidence: 'high' }), none), {}, 'the area estimate at high confidence is not a check');
  const adj = adjustmentsFor(facts({ confidence: 'high', compCount: 12 }), fig(facts()), none, noArea);
  assert.equal(adj[0].reason, 'checked on 12 similar Airbnbs nearby');
});
