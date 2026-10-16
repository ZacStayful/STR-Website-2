import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDeal } from './deal.ts';
import { growthRange } from './growth.ts';
import { rentRangeFor } from './rent.ts';
import { btlFlags, btlNumbers, buildBtlCard, judgedOf, parseBtlCard } from './card.ts';
import { btlSuitability, shortLeaseFlag } from './listing.ts';
import { epcLine, RULES_NOTE } from './nation.ts';
import { DEFAULT_BTL_SETTINGS, parseBtlBands, parseBtlBenchmark, parseBtlSettings, parseBtlAllowance, parseBtlLaunchFrom, parseBtlRent } from './config.ts';
import type { SourcedListing } from '../listing/sourcing.ts';

function b44Card() {
  const rent = rentRangeFor({ bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: 52.54, lng: -1.86, districtRentPcm: 1_155.64, districtYieldPct: 6.2 }, [])!;
  const deal = btlDeal(160_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: null })!;
  const growth = growthRange(160_000, 28.9, 3.9, 'B44', '2026-09-27');
  return buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 3, kind: 'house', country: 'england', outcode: 'B44', region: 'west_midlands', rent, deal, growth, rateDate: 'Sep 2026', band: '50k_100k', serviceChargeConfirmed: null, epc: null, shortLease: false });
}

test('the stored card round-trips and carries nothing that identifies the home', () => {
  const card = b44Card();
  const json = JSON.stringify(card);
  for (const word of ['address', 'postcode', 'url', 'photo', '"lat"', '"lng"']) assert.equal(json.includes(word), false, word);
  const back = parseBtlCard(JSON.parse(json));
  assert.deepEqual(back, card);
  assert.equal(card.floorsOk, true);
  assert.deepEqual(judgedOf(card).roiPct, card.roiPct);
});

test('a damaged or old card reads as nothing, never a crash', () => {
  assert.equal(parseBtlCard(null), null);
  assert.equal(parseBtlCard('not json'), null);
  assert.equal(parseBtlCard({ v: 99 }), null);
  const card = b44Card();
  assert.equal(parseBtlCard({ ...card, roiPct: { low: 1 } }), null);
});

test('exactly three numbers, following the priority, every one a range', () => {
  const card = b44Card();
  const income = btlNumbers(card, 'income');
  assert.deepEqual(income.map((n) => n.key), ['btlCash', 'btlMonthly', 'btlRoi']);
  assert.equal(income[0].value, '£51,200–£56,200');
  assert.match(income[1].value, /^£\d+–£\d+\/mo$/);
  assert.match(income[2].value, /^\d+\.\d%–\d+\.\d%$/);
  assert.deepEqual(btlNumbers(card, 'growth').map((n) => n.key), ['btlCash', 'btlValue5y', 'btlMonthly']);
  assert.deepEqual(btlNumbers(card, 'both').map((n) => n.key), ['btlCash', 'btlRoi', 'btlGrowth']);
  assert.match(btlNumbers(card, 'both')[2].value, / a year$/);
  // No growth figure: still three numbers.
  const noGrowth = { ...card, growth: null };
  assert.equal(btlNumbers(noGrowth, 'growth').length, 3);
  assert.equal(btlNumbers(noGrowth, 'both').length, 3);
});

test('flags: service charge, EPC below C, short lease, rough rent, and how far the search went', () => {
  const card = b44Card();
  assert.deepEqual(btlFlags(card), ['Rough rent estimate']);
  const flat = { ...card, rent: { ...card.rent, confidence: 'high' as const }, flags: { serviceChargeConfirmed: false, epc: 'E' as const, epcChecked: true, shortLease: true } };
  assert.deepEqual(btlFlags(flat, '24 miles from Leeds'), ['Service charge not confirmed', 'EPC below C', 'Short lease', '24 miles from Leeds']);
});

// ─── Listing rules ─────────────────────────────────────────────────────

function listing(over: Partial<SourcedListing> = {}): SourcedListing {
  return {
    source: 'onthemarket', id: '1', canonicalUrl: 'u', kind: 'sale', title: '2 bedroom terraced house for sale', address: null, postcode: null, outcode: 'ST1', postcodeArea: 'ST',
    lat: null, lng: null, bedrooms: 2, bathrooms: 1, price: { amount: 83_000, period: 'total' }, rawType: 'Terraced house', photo: null, ...over,
  };
}

test('a lender’s rules, not a short-let operator’s: a leasehold flat silent on short lets is fine', () => {
  assert.equal(btlSuitability(listing()), 'ok');
  assert.equal(btlSuitability(listing({ rawType: 'Flat', title: '1 bedroom flat for sale', tenure: 'leasehold' })), 'ok');
  assert.equal(btlSuitability(listing({ features: ['No short lets or Airbnb'] })), 'ok');
});

test('never: shared ownership, rooms, retirement, auctions, cash only, non-standard, short leases, too cheap', () => {
  assert.equal(btlSuitability(listing({ priceQualifier: 'Shared ownership' })), 'shared_ownership');
  assert.equal(btlSuitability(listing({ title: 'Room to rent in a house share' })), 'room');
  assert.equal(btlSuitability(listing({ features: ['Over 55s only'] })), 'age_restricted');
  assert.equal(btlSuitability(listing({ auction: true })), 'auction');
  assert.equal(btlSuitability(listing({ features: ['Cash Buyers Only'] })), 'cash_only');
  assert.equal(btlSuitability(listing({ features: ['Non-standard construction'] })), 'non_standard');
  assert.equal(btlSuitability(listing({ yearsRemainingOnLease: 60 })), 'short_lease');
  assert.equal(btlSuitability(listing({ price: { amount: 45_000, period: 'total' } })), 'low_price');
  assert.equal(btlSuitability(listing({ kind: 'rent' })), 'room');
});

test('a lease under 85 years is flagged, under 70 refused', () => {
  assert.equal(btlSuitability(listing({ yearsRemainingOnLease: 80 })), 'ok');
  assert.equal(shortLeaseFlag({ yearsRemainingOnLease: 80 }), true);
  assert.equal(shortLeaseFlag({ yearsRemainingOnLease: 120 }), false);
  assert.equal(shortLeaseFlag({ yearsRemainingOnLease: null }), false);
});

// ─── Nations ───────────────────────────────────────────────────────────

test('each nation’s rules note, and the EPC line where one applies', () => {
  assert.match(RULES_NOTE.england, /Renters’ Rights Act/);
  assert.match(RULES_NOTE.england, /1 May 2026/);
  assert.match(RULES_NOTE.wales, /Renting Homes \(Wales\) Act/);
  assert.match(RULES_NOTE.scotland, /private residential tenancies/);
  assert.match(RULES_NOTE.northern_ireland, /Private Tenancies Act/);
  assert.match(epcLine('england', 'D')!, /EPC C by 2030/);
  assert.match(epcLine('england', 'D')!, /£10,000/);
  assert.equal(epcLine('england', 'B'), null);
  assert.match(epcLine('wales', 'F')!, /EPC E/);
  assert.equal(epcLine('wales', 'D'), null);
  assert.equal(epcLine('scotland', 'G'), null);
  assert.equal(epcLine('northern_ireland', null), null);
});

// ─── Settings ──────────────────────────────────────────────────────────

test('missing or bad settings fall back to the decided values', () => {
  assert.deepEqual(parseBtlSettings({}), DEFAULT_BTL_SETTINGS);
  const s = parseBtlSettings({ btl_report_pence: '250', btl_finance: { ltvPct: 70, icrPct: 'x' }, btl_costs: '{"agentPct": 10}' });
  assert.equal(s.reportPence, 250);
  assert.equal(s.finance.ltvPct, 70);
  assert.equal(s.finance.icrPct, 125);
  assert.equal(s.costs.agentPct, 10);
  assert.equal(s.costs.repairsPct, 8);
});

test('bands, steps and widths stay in order whatever the row says', () => {
  assert.deepEqual(parseBtlBands([30_000, 60_000, 120_000]), [30_000, 60_000, 120_000]);
  assert.deepEqual(parseBtlBands([60_000, 30_000, 120_000]), [25_000, 50_000, 100_000]);
  assert.deepEqual(parseBtlBands('[1,2]'), [25_000, 50_000, 100_000]);
  assert.deepEqual(parseBtlBenchmark({ stepsMiles: [25, 10] }).stepsMiles, [10, 25, 50]);
  assert.equal(parseBtlBenchmark({ minDeals: 5, floorDeals: 20 }).floorDeals, 5);
  assert.equal(parseBtlRent({ minWidthPct: 30, maxWidthPct: 20 }).maxWidthPct, 30);
});

test('the paid shortlist’s line in Batch 16’s deal_checks row, and the launch switch', () => {
  assert.deepEqual(parseBtlAllowance({ dailyCapPence: 100 }), { valuations: 20, capPence: 100 });
  assert.deepEqual(parseBtlAllowance({ btlValuations: 0, btlCapPence: 50 }), { valuations: 0, capPence: 50 });
  assert.equal(parseBtlLaunchFrom(null), null);
  assert.equal(parseBtlLaunchFrom('null'), null);
  assert.equal(parseBtlLaunchFrom('"2026-10-20T08:00:00Z"'), '2026-10-20T08:00:00.000Z');
  assert.equal(parseBtlLaunchFrom('soon'), null);
});
