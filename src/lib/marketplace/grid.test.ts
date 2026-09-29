import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDealFilters, filtersToSearch, DEFAULT_FILTERS, SORT_LABELS, PUBLIC_DEAL_COLUMNS, PRIVATE_DEAL_COLUMNS, CARD_COLUMNS, badgesFor, describeType, PAGE_SIZE, priceLine, headlineFigure, areaDealView, isAuctionCard, browseFilters, kindOfTypes, typeClauseFor, typesParam } from './grid.ts';

test('parseDealFilters whitelists every value and clamps numbers', () => {
  assert.deepEqual(parseDealFilters({}), DEFAULT_FILTERS);
  const f = parseDealFilters({ kind: 'rent', areas: 'yo,bs,zz', beds: '4+', minPrice: '£100,000', maxPrice: '250000', minProfit: '12000', minUplift: '40%', sort: 'newest', page: '3' });
  assert.deepEqual(f, { kind: 'rent', types: [], areas: ['YO', 'BS'], beds: '4+', minPrice: 100_000, maxPrice: 250_000, minProfit: 12_000, minUplift: 40, sort: 'newest', view: 'all', page: 3 });
  const junk = parseDealFilters({ kind: 'drop table', beds: '9', sort: 'evil', view: 'everyone', page: '-4', minPrice: 'abc', maxPrice: '50', areas: ['YO', 'YO', 'nope'] });
  assert.deepEqual(junk, { ...DEFAULT_FILTERS, areas: ['YO'], maxPrice: 50 });
  assert.equal(parseDealFilters({ page: '99999' }).page, 500);
  assert.equal(parseDealFilters({ minPrice: '300000', maxPrice: '200000' }).maxPrice, null, 'an inverted range drops the ceiling');
  assert.deepEqual(parseDealFilters({ area: 'ng' }).areas, ['NG'], 'the singular form works too');
});

test('"Best for you" is the default sort; every other sort is written into the URL', () => {
  assert.equal(DEFAULT_FILTERS.sort, 'best');
  assert.equal(parseDealFilters({}).sort, 'best');
  assert.equal(parseDealFilters({ sort: 'best' }).sort, 'best');
  assert.equal(parseDealFilters({ sort: 'profit' }).sort, 'profit', 'the old default is still a choice');
  assert.equal(filtersToSearch({ ...DEFAULT_FILTERS, sort: 'profit' }), '?sort=profit');
  assert.equal(filtersToSearch({ ...DEFAULT_FILTERS, sort: 'best' }), '');
  assert.equal(SORT_LABELS.best, 'Best for you');
  assert.equal(Object.keys(SORT_LABELS)[0], 'best', 'first in the sort menu');
});

test('filtersToSearch round-trips and omits defaults', () => {
  assert.equal(filtersToSearch(DEFAULT_FILTERS), '');
  const f = parseDealFilters({ kind: 'sale', areas: 'YO,BS', beds: '2', minProfit: '20000', sort: 'uplift', page: '2' });
  const s = filtersToSearch(f);
  assert.equal(s, '?kind=sale&areas=YO%2CBS&beds=2&minProfit=20000&sort=uplift&page=2');
  assert.deepEqual(parseDealFilters(Object.fromEntries(new URLSearchParams(s))), f);
  assert.equal(filtersToSearch({ areas: ['YO'] }), '?areas=YO');
});

test('the kept and passed views survive the URL round trip; anything else is the default view', () => {
  assert.equal(parseDealFilters({ view: 'kept' }).view, 'kept');
  assert.equal(parseDealFilters({ view: 'passed' }).view, 'passed');
  assert.equal(parseDealFilters({ view: 'all' }).view, 'all');
  assert.equal(parseDealFilters({ view: ['kept', 'passed'] }).view, 'kept');
  const f = parseDealFilters({ kind: 'rent', view: 'passed', page: '2' });
  assert.equal(filtersToSearch(f), '?kind=rent&view=passed&page=2');
  assert.deepEqual(parseDealFilters(Object.fromEntries(new URLSearchParams(filtersToSearch(f)))), f);
  assert.equal(filtersToSearch({ ...DEFAULT_FILTERS, view: 'all' }), '', 'the default view is omitted');
});

test('the grid never selects what a member pays for', () => {
  for (const col of PRIVATE_DEAL_COLUMNS) {
    assert.ok(!PUBLIC_DEAL_COLUMNS.split(', ').includes(col), `${col} must not be public`);
  }
  for (const col of PRIVATE_DEAL_COLUMNS) {
    assert.ok(!CARD_COLUMNS.split(', ').includes(col), `${col} must not be on the card`);
  }
  assert.ok(CARD_COLUMNS.startsWith(PUBLIC_DEAL_COLUMNS), 'the card reads everything the grid does');
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

test('priceLine and headlineFigure', () => {
  assert.equal(priceLine({ price_amount: 250000, price_period: 'total' }), '£250,000');
  assert.equal(priceLine({ price_amount: 1200, price_period: 'pcm' }), '£1,200 pcm');
  assert.equal(priceLine({ price_amount: null, price_period: null }), null);
  assert.deepEqual(headlineFigure({ kind: 'sale', annual_profit: 24000, uplift_pct: 62.4 }), { big: '+62%', small: '£24,000/yr over a long let' });
  assert.deepEqual(headlineFigure({ kind: 'sale', annual_profit: null, uplift_pct: null }), { big: '—', small: 'over a long let' });
  assert.deepEqual(headlineFigure({ kind: 'rent', annual_profit: 9800, uplift_pct: null }), { big: '£9,800/yr', small: 'profit after rent' });
});

test('areaDealView carries nothing private and is fully formatted', () => {
  const card = {
    id: 'd1', source: 'rightmove', kind: 'sale', postcode_area: 'YO', outcode: 'YO24', town: 'Acomb', bedrooms: 3, price_amount: 250000, price_period: 'total',
    raw_type: 'Terraced', tenure: 'Freehold', band: 'qualified', annual_profit: 24000, uplift_pct: 62, reduced_at: null, listed_date: null, status: 'live',
    first_seen_at: ago(3), last_checked_live_at: ago(6), last_confirmed_at: ago(6), last_confirmed_via: 'live', has_photo: true,
  } as const;
  const v = areaDealView(card, '/api/deals/photo?id=d1', NOW);
  assert.equal(v.where, 'Acomb · YO24');
  assert.equal(v.type, '3 bed terraced · Freehold');
  assert.equal(v.price, '£250,000');
  assert.equal(v.figureBig, '+62%');
  assert.deepEqual(v.tags, ['New today']);
  assert.equal(v.freshnessKind, 'live');
  assert.equal(v.photoUrl, '/api/deals/photo?id=d1');
  for (const k of Object.keys(v)) assert.ok(!['canonical_url', 'address', 'postcode', 'photo', 'photos'].includes(k), `private key ${k} leaked`);
});

test('negative figures read with a proper minus, never "£-500" or "+-5%"', () => {
  assert.deepEqual(headlineFigure({ kind: 'rent', annual_profit: -500, uplift_pct: null }), { big: '−£500/yr', small: 'profit after rent' });
  assert.equal(headlineFigure({ kind: 'sale', annual_profit: -1200, uplift_pct: -5 }).big, '−5%');
  assert.equal(headlineFigure({ kind: 'sale', annual_profit: -1200, uplift_pct: -5 }).small, '−£1,200/yr over a long let');
});

test('an auction lot is read off its stored motivation verdict; a bare guide price is not one', () => {
  assert.equal(isAuctionCard({ motivation: { score: 20, firmScore: 20, fired: ['auction'] } }), true);
  assert.equal(isAuctionCard({ motivation: { score: 25, firmScore: 25, fired: ['price_reduced'] } }), false);
  assert.equal(isAuctionCard({ motivation: null }), false);
  assert.equal(isAuctionCard({}), false);
});

test('a card row carries the house cash in and the auction method as JSON paths, never a private column (Batch 16)', () => {
  assert.ok(CARD_COLUMNS.includes('deal_cash:deal->>cashRequired'));
  assert.ok(CARD_COLUMNS.includes('deal_auction:deal->auction->>method'));
  for (const col of PRIVATE_DEAL_COLUMNS) assert.ok(!CARD_COLUMNS.split(', ').includes(col), col);
});

test('Batch 16, Part C: the card columns carry the check’s comparables count, and nothing about where they are', () => {
  assert.ok(CARD_COLUMNS.includes('check_comps:screening->check->>compCount'));
  assert.ok(!/radiusKm|postcode|address|lat\b|lng\b/.test(CARD_COLUMNS.replace('postcode_area', '')), 'no location column beyond the area');
});

// ── Batch 17: the deal-types filter ──

test('type=: known types in the question’s order; "all" survives the round trip; nothing is "not chosen here"', () => {
  assert.deepEqual(typesParam('r2r,buy_str'), ['buy_str', 'r2r']);
  assert.deepEqual(typesParam(['brrr', 'junk']), ['brrr']);
  assert.deepEqual(typesParam('all'), ['buy_str', 'brrr', 'r2r']);
  assert.deepEqual(typesParam(undefined), []);
  assert.equal(filtersToSearch({ types: ['buy_str', 'r2r'] }), '?type=buy_str%2Cr2r');
  assert.equal(filtersToSearch({ types: ['buy_str', 'brrr', 'r2r'] }), '?type=all');
  assert.equal(filtersToSearch({ types: [] }), '');
  assert.deepEqual(parseDealFilters({ type: 'all' }).types, ['buy_str', 'brrr', 'r2r']);
  assert.deepEqual(parseDealFilters({}).types, []);
  assert.equal(filtersToSearch(parseDealFilters({ type: 'all' })), '?type=all', '"All types" is kept by every link built from it');
});

test('Browse starts on the profile’s own types; the URL wins; an old kind= link keeps meaning what it said (Q29)', () => {
  const none = parseDealFilters({});
  assert.deepEqual(browseFilters(none, false, ['buy_str']).types, ['buy_str']);
  assert.deepEqual(browseFilters(none, false, ['r2r', 'buy_str']).types, ['buy_str', 'r2r'], 'an unanswered profile: Short-let + Rent-to-rent, no BRRR (Q22)');
  assert.deepEqual(browseFilters(none, false, ['buy_str', 'brrr', 'r2r']).types, [], 'all three chosen: every type, nothing in the URL');
  const all = parseDealFilters({ type: 'all' });
  assert.deepEqual(browseFilters(all, true, ['buy_str']).types, ['buy_str', 'brrr', 'r2r'], '"All types" is one click');
  const sale = browseFilters(parseDealFilters({ kind: 'sale' }), false, ['r2r']);
  assert.deepEqual([sale.kind, sale.types], ['both', ['buy_str', 'brrr']]);
  const rent = browseFilters(parseDealFilters({ kind: 'rent' }), false, ['buy_str']);
  assert.deepEqual([rent.kind, rent.types], ['both', ['r2r']]);
  assert.equal(kindOfTypes(['buy_str', 'brrr']), 'sale');
  assert.equal(kindOfTypes(['r2r']), 'rent');
  assert.equal(kindOfTypes([]), 'both');
});

test('the types as query clauses: a rental is Rent-to-rent, a sale with a Project estimate BRRR, any other sale Short-let', () => {
  assert.equal(typeClauseFor([], true), null);
  assert.equal(typeClauseFor(['buy_str', 'brrr', 'r2r'], true), null);
  assert.deepEqual(typeClauseFor(['buy_str'], true), { kind: 'sale', project: 'null' });
  assert.deepEqual(typeClauseFor(['brrr'], true), { kind: 'sale', project: 'not_null' });
  assert.deepEqual(typeClauseFor(['r2r'], true), { kind: 'rent' });
  assert.deepEqual(typeClauseFor(['buy_str', 'brrr'], true), { kind: 'sale' });
  assert.deepEqual(typeClauseFor(['buy_str', 'r2r'], true), { project: 'null' });
  assert.deepEqual(typeClauseFor(['brrr', 'r2r'], true), { or: 'kind.eq.rent,project.not.is.null' });
  // Before the schema section: no Project deals, every sale Short-let.
  assert.deepEqual(typeClauseFor(['brrr'], false), { none: true });
  assert.deepEqual(typeClauseFor(['buy_str', 'brrr'], false), { kind: 'sale' });
  assert.equal(typeClauseFor(['buy_str', 'r2r'], false), null);
  // "Light refresh" (Q24): of the Project deals, the light ones only.
  assert.deepEqual(typeClauseFor(['brrr'], true, true), { kind: 'sale', project: 'light' });
  assert.deepEqual(typeClauseFor(['buy_str', 'brrr'], true, true), { kind: 'sale', or: 'project.is.null,project->>level.eq.light' });
  assert.deepEqual(typeClauseFor(['brrr', 'r2r'], true, true), { or: 'kind.eq.rent,project->>level.eq.light' });
  assert.deepEqual(typeClauseFor(['buy_str', 'r2r'], true, true), { project: 'null' }, 'no BRRR asked for: nothing changes');
});
