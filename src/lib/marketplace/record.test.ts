import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDealRecord, qualifiesForMarketplace, townFrom, feedStatusOf, mergeSnapshotIntoListing, snapshotFromDeal, areaRentKey, type AreaCardLike } from './record.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import type { ListingSnapshot } from '../listing/types.ts';

const listing = (over: Partial<SourcedListing> = {}): SourcedListing => ({
  source: 'rightmove',
  id: '1',
  canonicalUrl: 'https://www.rightmove.co.uk/properties/1',
  kind: 'sale',
  title: '3 bedroom terraced house for sale',
  address: '12 High Street, Fulford, York, YO10 4AB',
  postcode: 'YO10 4AB',
  outcode: 'YO10',
  postcodeArea: 'YO',
  lat: null,
  lng: null,
  bedrooms: 3,
  bathrooms: 1,
  price: { amount: 250_000, period: 'total' },
  rawType: 'Terraced',
  photo: null,
  tenure: 'Freehold',
  features: ['Garden', 'Chain free'],
  priceQualifier: null,
  sharedOwnership: null,
  shortLetsPermitted: null,
  listedDate: '2026-09-20',
  ...over,
});

const card: AreaCardLike = { code: 'YO', name: 'York', slug: 'york', byBedrooms: [{ bedrooms: 3, grossRevenue: 48_000, adr: 180 }], headline: { grossRevenue: 30_000, adr: 140 }, score: { score: 72 } };
const rents = new Map([[areaRentKey('YO', 3), { monthlyRent: 1_200, samples: 5 }]]);
const NOW = new Date('2026-09-25T12:00:00Z');

test('a purchase that clears 40% over a long let qualifies, and the record carries the grid columns', () => {
  const rec = buildDealRecord(listing(), { card, rentTable: rents, firstSeenAt: '2026-09-21T00:00:00Z', now: NOW });
  // 48,000 × 0.44 = 21,120 net; long-let net 1,200 × 12 × 0.9 = 12,960; costs 5,304 → surplus 2,856 → 22% uplift: medium.
  assert.equal(rec.band, 'medium');
  assert.equal(rec.annualProfit, 2_856);
  assert.equal(rec.upliftPct, 22);
  assert.equal(rec.town, 'York');
  assert.equal(rec.priceAmount, 250_000);
  assert.equal(rec.pricePeriod, 'total');
  assert.equal(rec.suitability, 'ok');
  assert.ok(rec.deal && rec.deal.kind === 'purchase');
  assert.ok(!qualifiesForMarketplace(rec));

  const strong = buildDealRecord(listing(), { card: { ...card, byBedrooms: [{ bedrooms: 3, grossRevenue: 60_000, adr: 200 }] }, rentTable: rents, firstSeenAt: null, now: NOW });
  // 60,000 × 0.44 = 26,400 − 5,304 − 12,960 = 8,136 → 62.8%: qualified.
  assert.equal(strong.band, 'qualified');
  assert.equal(strong.annualProfit, 8_136);
  assert.ok(qualifiesForMarketplace(strong));
});

test('a rental is judged on its advertised rent and normalised to pcm', () => {
  const rec = buildDealRecord(listing({ kind: 'rent', price: { amount: 300, period: 'pw' } }), { card: { ...card, byBedrooms: [{ bedrooms: 3, grossRevenue: 60_000, adr: 200 }] }, rentTable: rents, firstSeenAt: null, now: NOW });
  assert.equal(rec.pricePeriod, 'pcm');
  assert.equal(rec.priceAmount, 1_300);
  assert.equal(rec.screening.kind, 'rent-to-rent');
  assert.equal(rec.upliftPct, null);
  // 26,400 − 15,600 − 5,304 = 5,496: medium.
  assert.equal(rec.annualProfit, 5_496);
  assert.equal(rec.band, 'medium');
});

test('qualifiesForMarketplace: qualified and not unsuitable; unknown suitability is allowed in', () => {
  assert.ok(qualifiesForMarketplace({ band: 'qualified', suitability: 'ok' }));
  assert.ok(qualifiesForMarketplace({ band: 'qualified', suitability: 'unknown' }));
  assert.ok(!qualifiesForMarketplace({ band: 'qualified', suitability: 'room' }));
  assert.ok(!qualifiesForMarketplace({ band: 'qualified', suitability: 'shared_ownership' }));
  assert.ok(!qualifiesForMarketplace({ band: 'medium', suitability: 'ok' }));
  assert.ok(!qualifiesForMarketplace({ band: 'insufficient-data', suitability: 'ok' }));
});

test('townFrom takes the last non-postcode part of the address', () => {
  assert.equal(townFrom('12 High Street, Fulford, York, YO10 4AB'), 'York');
  assert.equal(townFrom('Flat 3, Kings Road, Bristol, BS1'), 'Bristol');
  assert.equal(townFrom('Kings Road, Bristol'), 'Bristol');
  assert.equal(townFrom('BS1 4AB'), null);
  assert.equal(townFrom(null), null);
  assert.equal(townFrom('', 'Bath, BA1'), 'Bath');
});

test('feedStatusOf reads a sold / let agreed marker out of the feed tags', () => {
  assert.equal(feedStatusOf(listing()), null);
  assert.equal(feedStatusOf(listing({ features: ['Sold STC'] })), 'under_offer');
  assert.equal(feedStatusOf(listing({ kind: 'rent', features: ['Let agreed'] })), 'let_agreed');
});

const snapshot: ListingSnapshot = {
  source: 'rightmove',
  id: '1',
  canonicalUrl: 'https://www.rightmove.co.uk/properties/1',
  fetchedAt: '2026-09-25T00:00:00Z',
  parserVersion: 3,
  kind: 'sale',
  title: '3 bed terraced house',
  displayAddress: '12 High Street, York',
  postcode: 'YO10 4AB',
  bedrooms: 3,
  price: { amount: 240_000, period: 'total', qualifier: 'Offers over' },
  status: 'available',
  tenure: 'Freehold',
  features: ['Garden'],
  photos: ['https://media.example/1.jpg', 'https://media.example/2.jpg'],
  listedDate: '2026-09-18',
  sharedOwnership: false,
  shortLetsPermitted: null,
  locationConfidence: 'outcode',
};

test('mergeSnapshotIntoListing lets the page overwrite the search card', () => {
  const merged = mergeSnapshotIntoListing(listing(), snapshot);
  assert.equal(merged.price?.amount, 240_000);
  assert.equal(merged.photo, 'https://media.example/1.jpg');
  assert.equal(merged.priceQualifier, 'Offers over');
  assert.equal(merged.listedDate, '2026-09-18');
  assert.equal(merged.address, '12 High Street, York');
  assert.equal(merged.sharedOwnership, false);
});

test('snapshotFromDeal returns the live snapshot when there is one, else a minimal valid one', () => {
  assert.equal(snapshotFromDeal(listing(), snapshot), snapshot);
  const minimal = snapshotFromDeal(listing({ source: 'zoopla', photo: 'https://media.example/z.jpg' }), null, NOW);
  assert.equal(minimal.source, 'zoopla');
  assert.equal(minimal.status, 'available');
  assert.deepEqual(minimal.photos, ['https://media.example/z.jpg']);
  assert.equal(minimal.displayAddress, '12 High Street, Fulford, York, YO10 4AB');
  assert.equal(minimal.fetchedAt, NOW.toISOString());
  assert.equal(minimal.parserVersion, 0);
});
