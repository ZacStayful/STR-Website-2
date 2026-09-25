import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadFilters, queryFor, filtersQuery, isFiltered, PAGE_SIZE } from './filters.ts';

const FUNNEL = '0f8b6a52-3c1e-4c55-9a4a-2b8c1d5e7f90';

test('an empty query string is the Qualified tab, page 1, unfiltered', () => {
  const f = parseLeadFilters({});
  assert.deepEqual(f, { tab: 'qualified', q: null, funnel: null, from: null, to: null, stage: null, page: 1 });
  assert.equal(isFiltered(f), false);
  assert.equal(filtersQuery(f), '');
});

test('junk is dropped, not guessed at', () => {
  const f = parseLeadFilters({ tab: 'everything', funnel: 'nope', from: '31/12/2025', stage: 'won', page: '-3' });
  assert.equal(f.tab, 'qualified');
  assert.equal(f.funnel, null);
  assert.equal(f.from, null);
  assert.equal(f.stage, null);
  assert.equal(f.page, 1);
});

test('filters round-trip through the query string', () => {
  const f = parseLeadFilters({ tab: 'archived', q: 'smith', funnel: FUNNEL, from: '2026-01-01', to: '2026-01-31', stage: 'contacted', page: '2' });
  const back = parseLeadFilters(Object.fromEntries(new URLSearchParams(filtersQuery(f, { page: 2 }))));
  assert.deepEqual(back, f);
});

test('changing a filter goes back to page 1', () => {
  const f = parseLeadFilters({ q: 'smith', page: '4' });
  assert.equal(filtersQuery(f, { tab: 'queued' }), '?tab=queued&q=smith');
});

test('the Archived tab asks only for archived leads; every other tab excludes them', () => {
  const f = parseLeadFilters({});
  assert.equal(queryFor(f, 'archived').archived, 'only');
  assert.equal(queryFor(f, 'archived').view, null);
  for (const tab of ['qualified', 'unqualified', 'queued'] as const) {
    assert.equal(queryFor(f, tab).archived, 'exclude');
    assert.equal(queryFor(f, tab).view, tab);
  }
});

test('page turns into an offset, and dates into a UK-day range', () => {
  const q = queryFor(parseLeadFilters({ page: '3', from: '2026-07-01', to: '2026-07-01' }));
  assert.equal(q.offset, 2 * PAGE_SIZE);
  assert.equal(q.since, '2026-06-30T23:00:00.000Z');
  assert.equal(q.until, '2026-07-01T22:59:59.999Z');
});
