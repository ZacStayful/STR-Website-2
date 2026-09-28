import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDealRecord, qualifiesForMarketplace, townFrom, feedStatusOf, mergeSnapshotIntoListing, snapshotFromDeal, areaRentKey, parseStoredDeal, type AreaCardLike } from './record.ts';
import type { SourcedListing } from '../listing/sourcing.ts';
import { R2R_QUALIFIED_PROFIT } from '../listing/screen.ts';
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
  const rec = buildDealRecord(listing(), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: '2026-09-21T00:00:00Z', now: NOW });
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

  const strong = buildDealRecord(listing(), { card: { ...card, byBedrooms: [{ bedrooms: 3, grossRevenue: 60_000, adr: 200 }] }, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  // 60,000 × 0.44 = 26,400 − 5,304 − 12,960 = 8,136 → 62.8%: qualified.
  assert.equal(strong.band, 'qualified');
  assert.equal(strong.annualProfit, 8_136);
  assert.ok(qualifiesForMarketplace(strong));
});

test('a rental is judged on its advertised rent and normalised to pcm', () => {
  const rec = buildDealRecord(listing({ kind: 'rent', price: { amount: 300, period: 'pw' } }), { card: { ...card, byBedrooms: [{ bedrooms: 3, grossRevenue: 60_000, adr: 200 }] }, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
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

// ── Batch 16 ──

test('every record carries its stream: a cheap sale is low entry at the house cash in, a rental is rent-to-rent, the bar is a rule', () => {
  const cheap = listing({ price: { amount: 120_000, period: 'total' }, bedrooms: 2 });
  const rec = buildDealRecord(cheap, { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  // 25% deposit £30,000 + SDLT £6,000 + setup £13,000 = £49,000.
  assert.ok(rec.deal && rec.deal.kind === 'purchase');
  assert.equal(rec.deal.cashRequired, 49_000);
  assert.equal(rec.deal.taxCountry, 'england');
  assert.equal(rec.stream, 'low_entry');
  const strict = buildDealRecord(cheap, { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW, rules: { lowEntry: { maxCashIn: 40_000 } } });
  assert.equal(strict.stream, 'top60');
  assert.equal(buildDealRecord(listing(), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW }).stream, 'top60', '£250,000 needs £84,000');
  assert.equal(buildDealRecord(listing({ kind: 'rent', price: { amount: 1_200, period: 'pcm' } }), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW }).stream, 'r2r');
});

test('an auction lot is priced as one (guide plus uplift, on a bridge) and its stream follows the bridging cash', () => {
  const lot = listing({ price: { amount: 130_000, period: 'total' }, bedrooms: 4, auction: true });
  const rec = buildDealRecord(lot, { card: { ...card, byBedrooms: [{ bedrooms: 4, grossRevenue: 60_000, adr: 220 }] }, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  assert.ok(rec.deal && rec.deal.kind === 'purchase' && rec.deal.auction, 'modelled as an auction');
  assert.equal(rec.deal.askingPrice, 149_500, 'the guide plus the usual 15%');
  assert.equal(rec.deal.auction.guide, 130_000);
  assert.equal(rec.deal.auction.method, 'traditional', 'no modern-method wording');
  // Bridging deposit £44,850 + SDLT £7,965 + premium £1,500 + fees £4,093 + setup £20,000.
  assert.equal(rec.deal.cashRequired, 78_408);
  assert.equal(rec.stream, 'top60');
  const online = buildDealRecord(listing({ ...lot, features: ['Scheduled for online auction', 'Legal pack available'] }), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  assert.equal(online.deal?.kind === 'purchase' ? online.deal.auction?.method : null, 'modern');
  const noUplift = buildDealRecord(lot, { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW, rules: { auctionTerms: { upliftPct: 0, traditionalPremium: 1_500, modernPremiumPct: 4.5, vatPct: 20, modernPremiumMin: 6_000, bridgingLtvPct: 70, bridgingMonthlyPct: 0.85, arrangementPct: 2, legalAndValuation: 2_000, termMonths: 12 } } });
  assert.equal(noUplift.deal?.kind === 'purchase' ? noUplift.deal.askingPrice : null, 130_000, 'the terms are a rule');
  assert.equal(buildDealRecord(listing({ price: { amount: 130_000, period: 'total' } }), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW }).deal?.kind === 'purchase' ? 'plain' : 'x', 'plain', 'no auction evidence: an ordinary purchase');
});

test('a listing pays its own nation’s transaction tax', () => {
  const scottish = listing({ address: '1 Royal Mile, Edinburgh, EH1 1AA', postcode: 'EH1 1AA', outcode: 'EH1', postcodeArea: 'EH' });
  const rec = buildDealRecord(scottish, { card: { ...card, code: 'EH' }, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  assert.ok(rec.deal && rec.deal.kind === 'purchase');
  assert.equal(rec.deal.taxCountry, 'scotland');
  // LBTT on £250,000: 2% of £105,000 = £2,100, plus the 8% ADS £20,000.
  assert.equal(rec.deal.stampDuty, 22_100);
});

test('a region’s figures standing in for an area screen at low confidence whatever the bedroom match', () => {
  const strong = { ...card, byBedrooms: [{ bedrooms: 3, grossRevenue: 60_000, adr: 200 }] };
  const own = buildDealRecord(listing(), { card: strong, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  assert.equal(own.screening.grossRevenue?.confidence, 'medium');
  assert.equal(own.screening.confidence, 'medium');
  const region = buildDealRecord(listing(), { card: { ...strong, fallback: true }, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  assert.equal(region.screening.grossRevenue?.confidence, 'low');
  assert.equal(region.screening.confidence, 'low');
  assert.equal(region.band, own.band, 'the figure is the same; only the trust in it drops');
});

test('parseStoredDeal reads a stored deal back defensively', () => {
  const rec = buildDealRecord(listing(), { card, rentTable: rents, r2rBar: R2R_QUALIFIED_PROFIT, firstSeenAt: null, now: NOW });
  const stored = JSON.parse(JSON.stringify(rec.deal)); // as the row holds it: no undefined fields
  assert.deepEqual(parseStoredDeal(stored), stored);
  assert.equal(parseStoredDeal(null), null);
  assert.equal(parseStoredDeal({ kind: 'purchase' }), null);
  assert.equal(parseStoredDeal({ kind: 'rent-to-rent', advertisedRentPcm: 900 }), null);
  assert.equal(parseStoredDeal('{"kind":"purchase"}'), null);
});
