import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFingerprint, parseStoredChoice, poolTally, rechooseAllowed } from './choice.ts';
import type { DealFilters } from '../marketplace/grid.ts';

const f = (o: Partial<DealFilters> = {}) => ({ kind: 'sale', types: ['buy_str'], areas: ['LS'], beds: 'any', minPrice: 100000, maxPrice: 200000, minProfit: null, minUplift: null, sort: 'profit', view: 'grid', page: 1, ...o }) as DealFilters;
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

test('counts distinct deals read, less excluded; budget-lifted reads are not counted; outside areas are nearby', async () => {
  const t = poolTally<{ id: string }>(new Set(['x']));
  const answers: Record<string, { id: string }[]> = { main: rows('a', 'b', 'x'), loose: rows('c', 'd'), near: rows('e', 'a') };
  const pool = t.wrap(async (filters) => (filters.areas.includes('YO') ? answers.near : filters.maxPrice === null ? answers.loose : answers.main));
  await pool(f(), 1000);
  await pool(f({ minPrice: null, maxPrice: null }), 50);
  await pool(f({ areas: ['YO'] }), 50);
  assert.deepEqual(t.result(null), { checked: 3, meeting: null, capped: false, nearby: true });
});

test('a read that fills its limit is capped', async () => {
  const t = poolTally<{ id: string }>(new Set());
  await t.wrap(async () => rows('a', 'b'))(f(), 2);
  assert.equal(t.result(1).capped, true);
});

test('fingerprints are stable across key order and area order, and change with an answer', () => {
  const a = answersFingerprint({ goals: { a: 1, b: { c: 2 } }, savedAreas: ['LS', 'YO'], modes: { x: 'must' } });
  const b = answersFingerprint({ goals: { b: { c: 2 }, a: 1 }, savedAreas: ['YO', 'LS'], modes: { x: 'must' } });
  const c = answersFingerprint({ goals: { a: 2, b: { c: 2 } }, savedAreas: ['LS', 'YO'], modes: { x: 'must' } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('re-choose: skipped when the answers are the same, refused when older', () => {
  const stored = parseStoredChoice({ checked: 4, fp: 'abc', answeredAt: '2026-10-01T10:00:05Z' });
  assert.equal(rechooseAllowed(stored, 'abc', '2026-10-01T10:00:09Z'), 'same');
  assert.equal(rechooseAllowed(stored, 'def', '2026-10-01T10:00:01Z'), 'stale');
  assert.equal(rechooseAllowed(stored, 'def', '2026-10-01T10:00:09Z'), 'go');
  assert.equal(rechooseAllowed(null, 'def', null), 'go');
});
