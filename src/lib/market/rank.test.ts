import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, type ExplorerRow } from './rank.ts';
import type { AreaCardData } from './explorer.ts';

function row(code: string, over: Record<string, unknown> = {}, personal: number | null = null, distance: number | null = null, saved = false): ExplorerRow {
  const card = {
    code, slug: code.toLowerCase(), name: code,
    headline: { grossRevenue: 20000, adr: 100, occupancy: 60, totalSamples: 10, bedroomsAvailable: [2] },
    byBedrooms: [], yieldOnCost: null, verdict: null,
    licensing: { status: 'unconfirmed' }, score: { score: 50 }, confidence: { rank: 2, tier: 'building' },
    competition: null, directBooking: null, managedByStayful: false,
    ...over,
  } as unknown as AreaCardData;
  return {
    card,
    personal: personal === null ? null : ({ score: personal, fit: { distanceMiles: distance } } as never),
    saved,
  };
}

test('sorts descending with nulls last', () => {
  const rows = [row('A', { score: { score: 40 } }), row('B', { score: null }), row('C', { score: { score: 70 } })];
  assert.deepEqual(sortRows(rows, 'stayful').map((r) => r.card.code), ['C', 'A', 'B']);
});

test('personal and distance sorts use the personal score', () => {
  const rows = [row('A', {}, 30, 80), row('B', {}, 90, 5), row('C', {}, null, null)];
  assert.deepEqual(sortRows(rows, 'personal').map((r) => r.card.code), ['B', 'A', 'C']);
  assert.deepEqual(sortRows(rows, 'distance').map((r) => r.card.code), ['B', 'A', 'C']);
});

test('least competitive puts low percentiles first', () => {
  const rows = [row('A', { competition: { percentile: 80 } }), row('B', { competition: { percentile: 10 } }), row('C')];
  assert.deepEqual(sortRows(rows, 'competition').map((r) => r.card.code), ['B', 'A', 'C']);
});

test('saved-first pins starred areas, ties fall back to confidence then score then name', () => {
  const rows = [row('B', { score: { score: 50 } }), row('A', { score: { score: 50 } }, null, null, true), row('C', { score: { score: 50 }, confidence: { rank: 3, tier: 'confirmed' } })];
  assert.deepEqual(sortRows(rows, 'stayful', true).map((r) => r.card.code), ['A', 'C', 'B']);
  assert.deepEqual(sortRows(rows, 'stayful').map((r) => r.card.code), ['C', 'A', 'B']);
});

test('trend sort uses the enquiry delta and ignores insufficient areas', () => {
  const t = (direction: 'up' | 'down' | 'insufficient', deltaPct: number | null) => ({ enquiries: { direction, deltaPct } }) as never;
  const rows = [{ ...row('A'), trend: t('up', 0.2) }, { ...row('B'), trend: t('insufficient', null) }, { ...row('C'), trend: t('down', -0.1) }];
  assert.deepEqual(sortRows(rows, 'trend').map((r) => r.card.code), ['A', 'C', 'B']);
});
