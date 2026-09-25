import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDealFilters, filtersToSearch, DEFAULT_FILTERS, PUBLIC_DEAL_COLUMNS, PRIVATE_DEAL_COLUMNS, badgesFor, describeType, PAGE_SIZE } from './grid.ts';

test('parseDealFilters whitelists every value and clamps numbers', () => {
  assert.deepEqual(parseDealFilters({}), DEFAULT_FILTERS);
  const f = parseDealFilters({ kind: 'rent', areas: 'yo,bs,zz', beds: '4+', minPrice: '£100,000', maxPrice: '250000', minProfit: '12000', minUplift: '40%', sort: 'newest', page: '3' });
  assert.deepEqual(f, { kind: 'rent', areas: ['YO', 'BS'], beds: '4+', minPrice: 100_000, maxPrice: 250_000, minProfit: 12_000, minUplift: 40, sort: 'newest', page: 3 });
  const junk = parseDealFilters({ kind: 'drop table', beds: '9', sort: 'evil', page: '-4', minPrice: 'abc', maxPrice: '50', areas: ['YO', 'YO', 'nope'] });
  assert.deepEqual(junk, { ...DEFAULT_FILTERS, areas: ['YO'], maxPrice: 50 });
  assert.equal(parseDealFilters({ page: '99999' }).page, 500);
  assert.equal(parseDealFilters({ minPrice: '300000', maxPrice: '200000' }).maxPrice, null, 'an inverted range drops the ceiling');
  assert.deepEqual(parseDealFilters({ area: 'ng' }).areas, ['NG'], 'the singular form works too');
});

test('filtersToSearch round-trips and omits defaults', () => {
  assert.equal(filtersToSearch(DEFAULT_FILTERS), '');
  const f = parseDealFilters({ kind: 'sale', areas: 'YO,BS', beds: '2', minProfit: '20000', sort: 'uplift', page: '2' });
  const s = filtersToSearch(f);
  assert.equal(s, '?kind=sale&areas=YO%2CBS&beds=2&minProfit=20000&sort=uplift&page=2');
  assert.deepEqual(parseDealFilters(Object.fromEntries(new URLSearchParams(s))), f);
  assert.equal(filtersToSearch({ areas: ['YO'] }), '?areas=YO');
});

test('the grid never selects what a member pays for', () => {
  for (const col of PRIVATE_DEAL_COLUMNS) {
    assert.ok(!PUBLIC_DEAL_COLUMNS.split(', ').includes(col), `${col} must not be public`);
  }
  assert.ok(PUBLIC_DEAL_COLUMNS.includes('id'));
  assert.ok(PUBLIC_DEAL_COLUMNS.includes('outcode'));
  assert.equal(PAGE_SIZE, 24);
});

const NOW = new Date('2026-09-25T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

test('badges: new today, reduced, and the freshness line prefers a live check', () => {
  const b = badgesFor({ first_seen_at: ago(3), reduced_at: ago(50), last_checked_live_at: ago(6), last_confirmed_at: ago(6), last_confirmed_via: 'live' }, NOW);
  assert.deepEqual(b.tags, ['New today', 'Reduced']);
  assert.equal(b.freshness, 'Checked live 6h ago');
  assert.equal(b.freshnessKind, 'live');
  const feed = badgesFor({ first_seen_at: ago(72), reduced_at: null, last_checked_live_at: ago(120), last_confirmed_at: ago(2), last_confirmed_via: 'feed' }, NOW);
  assert.deepEqual(feed.tags, []);
  assert.equal(feed.freshness, 'Confirmed by feed today');
  const stale = badgesFor({ first_seen_at: ago(72), reduced_at: ago(24 * 20), last_checked_live_at: null, last_confirmed_at: ago(24 * 3 + 1), last_confirmed_via: 'feed' }, NOW);
  assert.deepEqual(stale.tags, []);
  assert.equal(stale.freshness, 'Confirmed by feed 3 days ago');
  assert.equal(badgesFor({ first_seen_at: ago(72), reduced_at: null, last_checked_live_at: ago(30), last_confirmed_at: ago(40), last_confirmed_via: 'feed' }, NOW).freshness, 'Checked live yesterday');
});

test('describeType', () => {
  assert.equal(describeType({ bedrooms: 3, raw_type: 'Terraced', tenure: 'Freehold' }), '3 bed terraced · Freehold');
  assert.equal(describeType({ bedrooms: null, raw_type: null, tenure: 'Leasehold' }), 'Leasehold');
  assert.equal(describeType({ bedrooms: 2, raw_type: null, tenure: null }), '2 bed');
});
