import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addsByArea, isRescreenCandidate, RESCREEN_SEEN_DAYS, rescreenReport, storedSalePrice, type RescreenOutcome, type StoredSaleRow } from './cheap-rescreen.ts';
import { DEFAULT_LOW_ENTRY } from './config.ts';
import type { SourcedListing } from '../listing/sourcing.ts';

const NOW = new Date('2026-10-02T07:00:00Z');
const row = (over: Partial<StoredSaleRow> = {}): StoredSaleRow => ({ canonical_url: 'https://example.test/1', kind: 'sale', postcode_area: 'CA', last_seen_at: '2026-10-01T07:00:00Z', price: { amount: 120_000, period: 'total' }, ...over });

test('Batch 22c: a stored sale at a cheap listed price, seen in the last 3 days, is a candidate', () => {
  assert.equal(RESCREEN_SEEN_DAYS, 3);
  assert.equal(isRescreenCandidate(row(), DEFAULT_LOW_ENTRY, NOW), true);
  assert.equal(isRescreenCandidate(row({ price: { amount: 150_000, period: 'total' } }), DEFAULT_LOW_ENTRY, NOW), true);
  assert.equal(isRescreenCandidate(row({ price: { amount: 150_001, period: 'total' } }), DEFAULT_LOW_ENTRY, NOW), false);
  assert.equal(isRescreenCandidate(row({ price: { amount: '99000', period: 'total' } }), DEFAULT_LOW_ENTRY, NOW), true, 'a price stored as text');
  assert.equal(isRescreenCandidate(row({ kind: 'rent', price: { amount: 900, period: 'pcm' } }), DEFAULT_LOW_ENTRY, NOW), false);
  assert.equal(isRescreenCandidate(row({ price: null }), DEFAULT_LOW_ENTRY, NOW), false);
  assert.equal(isRescreenCandidate(row({ last_seen_at: '2026-09-28T06:00:00Z' }), DEFAULT_LOW_ENTRY, NOW), false, 'not seen for over 3 days');
  assert.equal(isRescreenCandidate(row(), { cheapMaxPrice: 100_000 }, NOW), false, 'the bar is the setting');
  assert.equal(storedSalePrice(row({ price: { amount: 0, period: 'total' } })), null);
});

const outcome = (over: Partial<RescreenOutcome>): RescreenOutcome => ({ listing: { canonicalUrl: 'u' } as SourcedListing, area: 'CA', bedrooms: 2, price: 120_000, band: 'qualified', stream: 'low_entry', annualProfit: 7_000, cashIn: 50_000, wouldAdd: true, unscreenable: false, ...over });

test('the report counts how they screen and lists what a run would add, best return first, never an address', () => {
  const report = rescreenReport([
    outcome({ area: 'LA', price: 115_000, annualProfit: 7_555, cashIn: 61_860 }),
    outcome({ area: 'SA', bedrooms: 3, price: 119_500, annualProfit: 13_039, cashIn: 52_350 }),
    outcome({ band: 'medium', wouldAdd: false }),
    outcome({ band: null, stream: null, unscreenable: true, wouldAdd: false }),
  ]);
  assert.equal(report.candidates, 4);
  assert.equal(report.unscreenable, 1);
  assert.deepEqual(report.byBand, { qualified: 2, medium: 1 });
  assert.equal(report.wouldAdd, 2);
  assert.deepEqual(report.sample, ['SA 3-bed £119,500: £13,039 a year on £52,350 in (24.9%)', 'LA 2-bed £115,000: £7,555 a year on £61,860 in (12.2%)']);
});

test('a run folds in only what would be added, by area', () => {
  const a = { canonicalUrl: 'a' } as SourcedListing;
  const b = { canonicalUrl: 'b' } as SourcedListing;
  const by = addsByArea([outcome({ listing: a, area: 'CA' }), outcome({ listing: b, area: 'CA' }), outcome({ area: 'LA', wouldAdd: false }), outcome({ area: null })]);
  assert.deepEqual([...by.keys()], ['CA']);
  assert.deepEqual(by.get('CA'), [a, b]);
});
