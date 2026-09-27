import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealAnalysisInput, dealListingPrice, fullPostcode, inputKeyFor } from './deal-input.ts';
import type { ListingSnapshot } from '../listing/types.ts';

function snap(over: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    source: 'rightmove',
    id: '123',
    canonicalUrl: 'https://www.rightmove.co.uk/properties/123',
    fetchedAt: '2026-09-27T00:00:00Z',
    parserVersion: 3,
    kind: 'sale',
    title: '2 bedroom flat for sale',
    displayAddress: 'Great Ancoats Street, Manchester',
    postcode: 'M4 5AE',
    outcode: 'M4',
    bedrooms: 2,
    bathrooms: 1,
    rawType: 'Apartment',
    price: { amount: 200_000, period: 'total' },
    features: ['Allocated parking', 'Balcony'],
    photos: ['https://example.test/p.jpg'],
    locationConfidence: 'exact',
    ...over,
  };
}

test('a full postcode is recognised and tidied; an outcode is not one', () => {
  assert.equal(fullPostcode('m45ae'), 'M4 5AE');
  assert.equal(fullPostcode(' NG1 4EX '), 'NG1 4EX');
  assert.equal(fullPostcode('SW1A1AA'), 'SW1A 1AA');
  assert.equal(fullPostcode('NG1'), null);
  assert.equal(fullPostcode(''), null);
  assert.equal(fullPostcode(undefined), null);
});

test('a sale runs on the listing facts, at the deal’s current price', () => {
  const r = dealAnalysisInput(snap(), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: { amount: 185_000, period: 'total' }, withPmi: false, checkedListingId: null });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.input.property.postcode, 'M4 5AE');
  assert.equal(r.input.property.bedrooms, 2);
  assert.equal(r.input.property.guests, 6);
  assert.equal(r.input.askingPrice, 185_000);
  assert.equal(r.input.rentPcm, null);
  assert.equal(r.input.propertyType, 'flat');
  assert.equal(r.input.hasParking, true);
  assert.equal(r.input.fromDeal, true);
  assert.equal(r.input.enhancedRequested, false);
  assert.equal(r.input.sourceListing?.url, 'https://www.rightmove.co.uk/properties/123');
});

test('the PMI box asks for the enhanced run', () => {
  const r = dealAnalysisInput(snap(), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: null, withPmi: true, checkedListingId: null });
  assert.ok(r.ok && r.input.enhancedRequested);
});

test('the reuse key ignores the price, so a price drop still reuses the analysis', () => {
  const a = dealAnalysisInput(snap(), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: { amount: 200_000, period: 'total' }, withPmi: false, checkedListingId: null });
  const b = dealAnalysisInput(snap(), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: { amount: 175_000, period: 'total' }, withPmi: true, checkedListingId: null });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(a.key, b.key);
});

test('the reuse key changes when what the providers are asked changes', () => {
  const a = dealAnalysisInput(snap(), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: null, withPmi: false, checkedListingId: null });
  const b = dealAnalysisInput(snap({ bedrooms: 3 }), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: null, withPmi: false, checkedListingId: null });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.notEqual(a.key, b.key);
    assert.equal(inputKeyFor(a.input), a.key);
  }
});

test('no full postcode: no analysis, and it says why', () => {
  const r = dealAnalysisInput(snap({ postcode: undefined, locationConfidence: 'outcode' }), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'sale', price: null, withPmi: false, checkedListingId: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'no_postcode');
});

test('a rental needs its rent; a weekly rent becomes monthly', () => {
  const none = dealAnalysisInput(snap({ kind: 'rent', price: undefined }), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'rent', price: null, withPmi: false, checkedListingId: null });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, 'no_price');
  const weekly = dealAnalysisInput(snap({ kind: 'rent' }), { canonicalUrl: 'https://www.rightmove.co.uk/properties/123', kind: 'rent', price: { amount: 300, period: 'pw' }, withPmi: false, checkedListingId: null });
  assert.ok(weekly.ok);
  if (weekly.ok) {
    assert.equal(weekly.input.rentPcm, 1300);
    assert.equal(weekly.input.askingPrice, null);
  }
});

test('a deal row price as a listing price', () => {
  assert.deepEqual(dealListingPrice('185000', 'total'), { amount: 185_000, period: 'total' });
  assert.deepEqual(dealListingPrice(1200, 'pcm'), { amount: 1200, period: 'pcm' });
  assert.equal(dealListingPrice(null, 'total'), null);
  assert.equal(dealListingPrice(100, 'night'), null);
  assert.equal(dealListingPrice(0, 'total'), null);
});
