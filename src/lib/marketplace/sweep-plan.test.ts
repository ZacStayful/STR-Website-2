import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countFrom, MAX_EMPTY_PER_DAY, planPass, sweepAreaCodes, sweepHistory, sweepQueries } from './sweep-plan.ts';
import type { HouseAreaCard } from '../listing/picks.ts';

const card = (code: string, score: number | null, tier: 'confirmed' | 'building' | 'early' = 'confirmed'): HouseAreaCard => ({
  code,
  name: code,
  slug: code.toLowerCase() + '-town',
  score: score === null ? null : { score },
  confidence: { tier },
});

const CARDS = [card('BA', 70), card('YO', 90), card('LE', 60), card('HG', 80, 'building'), card('ZE', 99, 'early'), card('XX', null)];
const NOW = new Date('2026-09-28T06:30:00Z');

test('countFrom takes positive whole numbers and falls back on anything else', () => {
  assert.equal(countFrom('45', 60), 45);
  assert.equal(countFrom('7.9', 60), 7);
  assert.equal(countFrom(undefined, 60), 60);
  assert.equal(countFrom('0', 60), 60);
  assert.equal(countFrom('-3', 60), 60);
  assert.equal(countFrom('lots', 60), 60);
});

test('sweepAreaCodes: scored, not early, best first, capped', () => {
  assert.deepEqual(sweepAreaCodes(CARDS, 60), ['YO', 'HG', 'BA', 'LE']);
  assert.deepEqual(sweepAreaCodes(CARDS, 2), ['YO', 'HG']);
  assert.deepEqual(sweepAreaCodes([], 60), []);
});

test('sweepQueries: both kinds per area, unbounded keys, capped', () => {
  const qs = sweepQueries(CARDS, 60, 120);
  assert.equal(qs.length, 8);
  assert.deepEqual(qs.slice(0, 2).map((q) => q.key), ['sale|YO|||', 'rent|YO|||']);
  assert.ok(qs.every((q) => q.minPrice === null && q.maxPrice === null && q.minBedrooms === null));
  assert.equal(sweepQueries(CARDS, 60, 3).length, 3);
});

test('sweepHistory: today’s finished and empty searches, and the day each was last finished', () => {
  const h = sweepHistory(
    [
      { startedAt: '2026-09-28T05:00:28Z', doneKeys: ['sale|YO|||', 'rent|YO|||'], emptyKeys: ['rent|LE|||'] },
      { startedAt: '2026-09-28T05:10:28Z', doneKeys: ['sale|HG|||'], emptyKeys: ['rent|LE|||', 42] },
      { startedAt: '2026-09-27T06:50:00Z', doneKeys: ['sale|BA|||', 'sale|YO|||'], emptyKeys: ['sale|BA|||'] },
      { startedAt: '2026-09-25T06:00:00Z', doneKeys: ['rent|BA|||'] },
      { startedAt: 'not a date', doneKeys: ['sale|LE|||'] },
      { startedAt: '2026-09-28T05:20:00Z', doneKeys: 'junk' },
    ],
    NOW,
  );
  assert.deepEqual([...h.doneToday].sort(), ['rent|YO|||', 'sale|HG|||', 'sale|YO|||']);
  assert.equal(h.emptyToday.get('rent|LE|||'), 2);
  assert.equal(h.emptyToday.get('sale|BA|||'), undefined, 'yesterday’s empties do not count today');
  assert.equal(h.lastDoneDay.get('sale|YO|||'), '2026-09-28');
  assert.equal(h.lastDoneDay.get('sale|BA|||'), '2026-09-27');
  assert.equal(h.lastDoneDay.get('rent|BA|||'), '2026-09-25');
  assert.equal(h.lastDoneDay.has('sale|LE|||'), false);
});

test('sweepHistory copes with no runs at all', () => {
  const h = sweepHistory([], NOW);
  assert.equal(h.doneToday.size, 0);
  assert.equal(h.emptyToday.size, 0);
  assert.equal(h.lastDoneDay.size, 0);
});

test('planPass skips what is done today and what came back empty too often', () => {
  const qs = sweepQueries(CARDS, 60, 120);
  const h = sweepHistory([{ startedAt: '2026-09-28T05:00:00Z', doneKeys: ['sale|YO|||', 'rent|YO|||'], emptyKeys: Array(MAX_EMPTY_PER_DAY).fill('rent|LE|||') }], NOW);
  const plan = planPass(qs, h);
  assert.equal(plan.doneToday, 2);
  assert.equal(plan.leftForTomorrow, 1);
  assert.equal(plan.pending.length, 5);
  assert.ok(!plan.pending.some((q) => q.key === 'sale|YO|||' || q.key === 'rent|LE|||'));
});

test('planPass keeps the score order when nothing else differs', () => {
  const qs = sweepQueries(CARDS, 60, 120);
  const plan = planPass(qs, sweepHistory([], NOW));
  assert.deepEqual(plan.pending.map((q) => q.key), qs.map((q) => q.key));
});

test('planPass puts searches missed on an earlier day first, never-finished first of all', () => {
  const qs = sweepQueries(CARDS, 60, 120);
  const h = sweepHistory(
    [
      { startedAt: '2026-09-27T05:00:00Z', doneKeys: ['sale|YO|||', 'rent|YO|||', 'sale|HG|||', 'rent|HG|||', 'sale|BA|||', 'rent|BA|||'] },
      { startedAt: '2026-09-26T05:00:00Z', doneKeys: ['sale|LE|||'] },
    ],
    NOW,
  );
  const keys = planPass(qs, h).pending.map((q) => q.key);
  assert.deepEqual(keys.slice(0, 2), ['rent|LE|||', 'sale|LE|||'], 'rent|LE never finished, sale|LE last finished two days ago');
  assert.deepEqual(keys.slice(2), ['sale|YO|||', 'rent|YO|||', 'sale|HG|||', 'rent|HG|||', 'sale|BA|||', 'rent|BA|||']);
});

test('planPass puts wanted areas first, most wanted first, whatever else is true', () => {
  const qs = sweepQueries(CARDS, 60, 120);
  const h = sweepHistory([{ startedAt: '2026-09-20T05:00:00Z', doneKeys: ['sale|BA|||'] }], NOW);
  const keys = planPass(qs, h, new Map([['LE', 2], ['BA', 5], ['YO', 0], ['HG', Number.NaN]])).pending.map((q) => q.key);
  assert.deepEqual(keys, [
    // BA is wanted most; its never-finished rent search goes before the sale one finished on the 20th.
    'rent|BA|||',
    'sale|BA|||',
    'sale|LE|||',
    'rent|LE|||',
    // Nobody wants YO or HG (a junk score counts as nobody): score order, as before.
    'sale|YO|||',
    'rent|YO|||',
    'sale|HG|||',
    'rent|HG|||',
  ]);
});
