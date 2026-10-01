import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepAreas, isStrongMatch, nextPage, planDeepSearch, planSignupSearch, pmiFollowUp } from './member-search-plan.ts';
import { deepCharge, deepQuote, estimateRaw } from './member-search-quote.ts';

const now = new Date('2026-10-01T12:00:00Z');
const o = { thinStock: 5, freshHours: 24, now };

test('signup search: only screenable areas that are thin or stale, thin first, OnTheMarket first', () => {
  const steps = planSignupSearch([
    { area: 'LS', kind: 'sale', screenable: true, live: 12, searchedAt: '2026-10-01T06:00:00Z' },
    { area: 'YO', kind: 'sale', screenable: true, live: 2, searchedAt: '2026-10-01T06:00:00Z' },
    { area: 'HG', kind: 'sale', screenable: true, live: 9, searchedAt: '2026-09-29T06:00:00Z' },
    { area: 'ZE', kind: 'sale', screenable: false, live: 0, searchedAt: null },
  ], o);
  assert.deepEqual(steps.map((s) => s.area), ['YO', 'HG']);
  assert.ok(steps.every((s) => s.source === 'onthemarket'));
  assert.equal(steps[0].thin, true);
});

test('PMI only follows when the area stays thin', () => {
  const step = { area: 'YO', kind: 'sale' as const, source: 'onthemarket' as const, page: 1, thin: true };
  assert.equal(pmiFollowUp(step, 3, 5)?.source, 'pmi');
  assert.equal(pmiFollowUp(step, 5, 5), null);
  assert.equal(pmiFollowUp({ ...step, thin: false }, 0, 5), null);
});

test('deep search: own areas plus N nearby, every kind, paged while pages are full', () => {
  assert.deepEqual(deepAreas(['LS', 'YO'], ['YO', 'HG', 'BD', 'WF'], 2), ['LS', 'YO', 'HG', 'BD']);
  assert.equal(planDeepSearch(['LS', 'YO'], ['sale', 'rent']).length, 4);
  const s = { area: 'LS', kind: 'sale' as const, source: 'onthemarket' as const, page: 1, thin: false };
  assert.equal(nextPage(s, 25, 25, 4)?.page, 2);
  assert.equal(nextPage(s, 10, 25, 4), null);
  assert.equal(nextPage({ ...s, page: 4 }, 25, 25, 4), null);
});

test('a strong match needs no missed must-have, enough checks and the %', () => {
  const s = { strongMatchPct: 90, strongMatchMinChecked: 5 };
  assert.equal(isStrongMatch({ matchPct: 89.6, checks: 6, missedMustHave: false }, s), true);
  assert.equal(isStrongMatch({ matchPct: 95, checks: 4, missedMustHave: false }, s), false);
  assert.equal(isStrongMatch({ matchPct: 100, checks: 8, missedMustHave: true }, s), false);
  assert.equal(isStrongMatch({ matchPct: null, checks: 3, missedMustHave: false }, s), false);
  assert.equal(isStrongMatch(null, s), false);
});

test('deep quote: about and up to, × markup, less the first-time discount; the charge never exceeds up to', () => {
  const q = deepQuote({ estimateRawPence: 40, maxRawPence: 300, markup: 5, discountPct: 50 });
  assert.equal(q.aboutBasePence, 100);
  assert.equal(q.upToBasePence, 750);
  assert.equal(deepCharge(52.4, q, 5), 131);
  assert.equal(deepCharge(400, q, 5), 750);
  assert.equal(deepCharge(0, q, 5), 0);
  assert.equal(estimateRaw([{ source: 'onthemarket' }, { source: 'pmi' }], { onthemarket: 0.2, pmi: 2 }, 3, 5), 17.2);
});
