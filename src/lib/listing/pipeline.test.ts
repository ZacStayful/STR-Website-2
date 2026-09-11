import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealReturn, listingFit, sortListings, toCheckedListingRow, isPipelineStatus, type CheckedListingRow } from './pipeline.ts';
import { purchaseDeal, rentToRentDeal } from './deal.ts';

const base = { grossRevenue: 30_000, adr: 150, bedrooms: 2 };

function row(over: Partial<CheckedListingRow>): CheckedListingRow {
  return { id: 'a', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', source: 'rightmove', kind: 'sale', postcode: null, postcodeArea: 'M', lat: null, lng: null, title: 't', displayAddress: null, photo: null, bedrooms: 2, price: null, listingStatus: null, status: 'watching', notes: '', shareToken: null, analysedReportId: null, quick: null, deal: null, updatedAt: '2026-09-01T00:00:00.000Z', ...over };
}

test('dealReturn exposes yield or margin', () => {
  assert.equal(dealReturn(purchaseDeal(300_000, base)), 10);
  assert.equal(dealReturn(rentToRentDeal(1000, base)), rentToRentDeal(1000, base).monthlyMargin);
  assert.equal(dealReturn(null), null);
});

test('listingFit blends area fit with the deal against targets', () => {
  const good = row({ deal: purchaseDeal(200_000, base) }); // 15% yield vs 10% target → 90 deal pts
  const bad = row({ deal: purchaseDeal(600_000, base) }); // 5% → 30 deal pts
  assert.ok(listingFit(good, 70)! > listingFit(bad, 70)!);
  assert.equal(listingFit(row({}), null), null);
  assert.equal(listingFit(row({}), 55), 55);
});

test('sortListings orders by fit, newest and return', () => {
  const a = row({ id: 'a', deal: purchaseDeal(200_000, base), updatedAt: '2026-09-01T00:00:00.000Z' });
  const b = row({ id: 'b', deal: purchaseDeal(600_000, base), updatedAt: '2026-09-05T00:00:00.000Z' });
  assert.deepEqual(sortListings([b, a], 'fit', () => 60).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(sortListings([a, b], 'newest', () => null).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(sortListings([b, a], 'return', () => null).map((r) => r.id), ['a', 'b']);
});

test('toCheckedListingRow trims a stored row and rejects junk', () => {
  const r = toCheckedListingRow({ id: 'x', canonical_url: 'u', source: 'airbnb', kind: 'str', snapshot: { title: 'T', photos: ['p'], price: { amount: 100, period: 'night' }, bedrooms: 3 }, status: 'offer', notes: 'n', updated_at: '2026-09-06T00:00:00.000Z' })!;
  assert.equal(r.title, 'T');
  assert.equal(r.photo, 'p');
  assert.deepEqual(r.price, { amount: 100, period: 'night' });
  assert.equal(r.status, 'offer');
  assert.equal(toCheckedListingRow({}), null);
  assert.equal(isPipelineStatus('viewing'), true);
  assert.equal(isPipelineStatus('sold'), false);
});
