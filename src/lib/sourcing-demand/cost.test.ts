import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualPence, effectiveCap, reservePence, type CallRow, type UnitCostOf } from './cost.ts';

// The live unit costs today: PMI listings 2p a credit, an OnTheMarket results page 0.2p (nominal).
const TABLE: Record<string, number> = { 'pmi:listings': 2, 'onthemarket:search_page': 0.2, 'onthemarket:listing_page': 0.2 };
const unitCostOf: UnitCostOf = (p, u) => TABLE[`${p}:${u}`] ?? null;
const row = (over: Partial<CallRow>): CallRow => ({ provider: 'pmi', unit: 'listings', quantity: 1, ok: true, cache_hit: false, ...over });

test('reservePence: a paid but empty PMI answer plus the OnTheMarket fallback', () => {
  assert.equal(reservePence(unitCostOf, 2), 2.2);
});

test('reservePence falls back to the broker’s PMI figure when the table has no PMI row', () => {
  assert.equal(reservePence(() => null, 2), 2);
  assert.equal(reservePence((p, u) => (p === 'onthemarket' && u === 'search_page' ? 0.2 : null), 2), 2.2);
});

test('actualPence: PMI answered', () => {
  assert.equal(actualPence([row({})], unitCostOf), 2);
});

test('actualPence: PMI paid but empty, then the OnTheMarket page', () => {
  assert.equal(actualPence([row({}), row({ provider: 'onthemarket', unit: 'search_page' })], unitCostOf), 2.2);
});

test('actualPence: PMI down (failed, free), OnTheMarket answered: the page only', () => {
  assert.equal(actualPence([row({ ok: false, quantity: 0 }), row({ provider: 'onthemarket', unit: 'search_page' })], unitCostOf), 0.2);
});

test('actualPence: a retried PMI call counts every paid attempt', () => {
  assert.equal(actualPence([row({ ok: false }), row({})], unitCostOf), 2);
  assert.equal(actualPence([row({}), row({})], unitCostOf), 4);
});

test('actualPence: cache hits, failures, unknown units and missing units cost nothing', () => {
  assert.equal(actualPence([row({ cache_hit: true, quantity: 0 }), row({ ok: null }), row({ unit: null }), row({ provider: 'mystery', unit: 'x' })], unitCostOf), 0);
  assert.equal(actualPence([], unitCostOf), 0);
});

test('actualPence: quantity multiplies, a missing quantity counts as one', () => {
  assert.equal(actualPence([row({ quantity: 3 })], unitCostOf), 6);
  assert.equal(actualPence([row({ quantity: null })], unitCostOf), 2);
});

test('effectiveCap: an override can only lower the cap', () => {
  assert.equal(effectiveCap(10_000, null), 10_000);
  assert.equal(effectiveCap(10_000, undefined), 10_000);
  assert.equal(effectiveCap(10_000, 1), 1);
  assert.equal(effectiveCap(10_000, 0), 0);
  assert.equal(effectiveCap(10_000, 50_000), 10_000, 'never raised');
  assert.equal(effectiveCap(10_000, -5), 10_000);
  assert.equal(effectiveCap(10_000, Number.NaN), 10_000);
  assert.equal(effectiveCap(10_000, 12.7), 12);
});
