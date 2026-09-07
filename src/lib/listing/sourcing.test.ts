import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  areasForGoals,
  queriesForGoals,
  onTheMarketSearchUrl,
  parseOnTheMarketSearch,
  fromPmiListings,
  dealForSourced,
  rankPicks,
  sourcingEmail,
  budgetBounds,
  type AreaRef,
} from './sourcing.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, '__fixtures__', name), 'utf8');

const areas: AreaRef[] = [
  { code: 'NG', name: 'Nottingham', slug: 'nottingham', centroid: { lat: 52.95, lng: -1.15 }, fit: 70 },
  { code: 'DE', name: 'Derby', slug: 'derby', centroid: { lat: 52.92, lng: -1.48 }, fit: 60 },
  { code: 'M', name: 'Manchester', slug: 'manchester', centroid: { lat: 53.48, lng: -2.24 }, fit: 80 },
  { code: 'AB', name: 'Aberdeen', slug: 'aberdeen', centroid: { lat: 57.15, lng: -2.1 }, fit: 90 },
  { code: 'ZZ', name: 'ZZ postcode area', slug: 'zz', centroid: null, fit: null },
];

const goals: MarketGoals = { ...DEFAULT_GOALS, home: { postcode: 'NG1 1AA', lat: 52.95, lng: -1.15 }, maxDistanceMiles: 25, budget: '200-350', bedrooms: 2 };

test('areasForGoals = saved ∪ within-radius, best fit first, capped', () => {
  const picked = areasForGoals(goals, ['zz'], areas);
  assert.deepEqual(
    picked.map((a) => a.code),
    ['NG', 'DE', 'ZZ'],
  );
  const capped = areasForGoals({ ...goals, maxDistanceMiles: 100 }, [], areas, 2);
  assert.deepEqual(
    capped.map((a) => a.code),
    ['M', 'NG'],
  );
  // No home and nothing saved → nothing to search.
  assert.deepEqual(areasForGoals({ ...goals, home: null }, [], areas), []);
});

test('queriesForGoals carries budget on sale queries only and both kinds when asked', () => {
  const qs = queriesForGoals({ ...goals, sourcingKind: 'both' }, [], areas);
  const ng = qs.filter((q) => q.area === 'NG');
  assert.equal(ng.length, 2);
  const sale = ng.find((q) => q.kind === 'sale')!;
  const rent = ng.find((q) => q.kind === 'rent')!;
  assert.equal(sale.key, 'sale|NG|200000|350000|2');
  assert.equal(rent.key, 'rent|NG|||2');
  assert.deepEqual(budgetBounds('500+'), { min: 500_000, max: null });
});

test('onTheMarketSearchUrl builds the city search and refuses generated slugs', () => {
  const [q] = queriesForGoals(goals, [], areas);
  assert.equal(onTheMarketSearchUrl(q), 'https://www.onthemarket.com/for-sale/property/nottingham/?max-price=350000&min-price=200000&min-bedrooms=2&radius=5');
  assert.equal(onTheMarketSearchUrl({ ...q, area: 'ZZ', areaSlug: 'zz' }), null);
});

test('parseOnTheMarketSearch reads sale and rent cards', () => {
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale');
  assert.equal(sale.length, 6);
  const first = sale[0];
  assert.equal(first.id, '19782017');
  assert.equal(first.canonicalUrl, 'https://www.onthemarket.com/details/19782017/');
  assert.deepEqual(first.price, { amount: 120_000, period: 'total' });
  assert.equal(first.bedrooms, 2);
  assert.equal(first.outcode, 'NG1');
  assert.equal(first.postcodeArea, 'NG');
  assert.ok(first.lat && first.lng);
  assert.ok(first.photo?.startsWith('https://'));
  // No agent details survive.
  assert.ok(!JSON.stringify(sale).includes('telephone'));

  const rent = parseOnTheMarketSearch(fixture('onthemarket-search-rent.html'), 'rent');
  assert.equal(rent.length, 6);
  assert.deepEqual(rent[0].price, { amount: 1450, period: 'pcm' });
  assert.equal(parseOnTheMarketSearch('<html></html>', 'sale').length, 0);
});

test('fromPmiListings keeps only listings with a recognisable portal URL', () => {
  const out = fromPmiListings(
    {
      listings: [
        { address: '1 High St, Nottingham', postcode: 'NG1 1AA', price: 250_000, bedrooms: 2, property_type: 'flat', url: 'https://www.rightmove.co.uk/properties/123#/?channel=RES_BUY' },
        { address: '2 Low St', price: 300_000, url: 'https://example.com/x' },
        { address: '3 Mid St', price: 1200, bedrooms: 3, url: 'https://www.zoopla.co.uk/to-rent/details/456/' },
      ],
    },
    'sale',
  );
  // Zoopla is recognised but not fetchable by us, so the digest must not link to it.
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'rightmove');
  assert.equal(out[0].canonicalUrl, 'https://www.rightmove.co.uk/properties/123');
  assert.equal(out[0].postcode, 'NG1 1AA');
  assert.equal(out[0].postcodeArea, 'NG');
  assert.deepEqual(fromPmiListings(null, 'sale'), []);
});

test('dealForSourced uses per-bedroom figures and rankPicks drops losing deals', () => {
  const figures = { byBedrooms: [{ bedrooms: 2, grossRevenue: 30_000, adr: 140 }], headline: { grossRevenue: 24_000, adr: 120 } };
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale');
  const deal = dealForSourced(sale[0], figures, null)!;
  assert.equal(deal.kind, 'purchase');
  assert.equal(deal.grossRevenue, 30_000);
  // £120k at £30k gross = 25% gross yield.
  assert.ok(deal.kind === 'purchase' && deal.grossYieldPct > 20);

  const rent = parseOnTheMarketSearch(fixture('onthemarket-search-rent.html'), 'rent');
  const r2r = dealForSourced(rent[0], { byBedrooms: [], headline: { grossRevenue: 12_000, adr: 80 } }, null)!;
  assert.equal(r2r.kind, 'rent-to-rent');
  assert.ok(r2r.kind === 'rent-to-rent' && r2r.monthlyMargin < 0);

  const picks = rankPicks([
    { listing: sale[0], deal, areaFit: 70, areaName: 'Nottingham' },
    { listing: rent[0], deal: r2r, areaFit: 70, areaName: 'Nottingham' },
    { listing: sale[1], deal: null, areaFit: 70, areaName: 'Nottingham' },
  ]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].listing.id, '19782017');
  assert.ok(picks[0].fit > 70);
  assert.equal(dealForSourced(sale[0], null, null), null);
});

test('sourcing email links to the analyser and the explorer check flow', () => {
  const figures = { byBedrooms: [], headline: { grossRevenue: 30_000, adr: 140 } };
  const sale = parseOnTheMarketSearch(fixture('onthemarket-search-sale.html'), 'sale').slice(0, 2);
  const picks = rankPicks(sale.map((l) => ({ listing: l, deal: dealForSourced(l, figures, null), areaFit: 65, areaName: 'Nottingham' })));
  const mail = sourcingEmail(picks, 'https://intelligence.stayful.co.uk');
  assert.equal(mail.subject, '2 new listings that fit your goals');
  assert.ok(mail.text.includes('/estimate?listing=https%3A%2F%2Fwww.onthemarket.com%2Fdetails%2F19782017%2F'));
  assert.ok(mail.html.includes('/markets?check=https%3A%2F%2Fwww.onthemarket.com'));
  assert.ok(mail.html.includes('gross yield'));
});
