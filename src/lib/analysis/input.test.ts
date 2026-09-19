import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnalysisInput } from './input.ts';

const valid = { address: ' 12 Oak Street ', postcode: ' m1 4bt ', bedrooms: 2, guests: 4 };

function ok(body: unknown) {
  const r = parseAnalysisInput(body);
  assert.equal(r.ok, true, `expected ok, got: ${r.ok ? '' : r.error}`);
  if (!r.ok) throw new Error('unreachable');
  return r.input;
}

test('trims the address and upper-cases the postcode', () => {
  const i = ok(valid);
  assert.equal(i.property.address, '12 Oak Street');
  assert.equal(i.property.postcode, 'M1 4BT');
});

test('rejects a missing or blank address', () => {
  assert.deepEqual(parseAnalysisInput({ ...valid, address: '   ' }), { ok: false, error: 'A valid property address is required.' });
  assert.equal(parseAnalysisInput({ ...valid, address: undefined }).ok, false);
});

test('rejects a postcode shorter than three characters', () => {
  assert.deepEqual(parseAnalysisInput({ ...valid, postcode: 'M1' }), { ok: false, error: 'A valid UK postcode is required.' });
});

test('bedrooms must be 0-10 and guests 1-16', () => {
  assert.equal(parseAnalysisInput({ ...valid, bedrooms: 11 }).ok, false);
  assert.equal(parseAnalysisInput({ ...valid, bedrooms: -1 }).ok, false);
  assert.equal(parseAnalysisInput({ ...valid, guests: 0 }).ok, false);
  assert.equal(parseAnalysisInput({ ...valid, guests: 17 }).ok, false);
  assert.equal(ok({ ...valid, bedrooms: 0 }).property.bedrooms, 0); // studio
  assert.equal(ok({ ...valid, guests: 16 }).property.guests, 16);
});

test('parking maps to spaces, and on-street does not count as parking', () => {
  assert.deepEqual(
    (({ parkingSpaces, hasParking }) => ({ parkingSpaces, hasParking }))(ok({ ...valid, parking: 'driveway_2' })),
    { parkingSpaces: 2, hasParking: true },
  );
  assert.deepEqual(
    (({ parkingSpaces, hasParking }) => ({ parkingSpaces, hasParking }))(ok({ ...valid, parking: 'on_street' })),
    { parkingSpaces: 0, hasParking: false },
  );
  // An unknown value falls back to no parking rather than throwing.
  assert.equal(ok({ ...valid, parking: 'helipad' }).hasParking, false);
});

test('outdoor space and property type map to the provider slugs', () => {
  assert.equal(ok({ ...valid, outdoorSpace: 'roof_terrace' }).outdoorSpace, 'balcony_terrace');
  assert.equal(ok({ ...valid, outdoorSpace: 'nonsense' }).outdoorSpace, 'none');
  assert.equal(ok({ ...valid, propertyType: 'Semi-detached' }).propertyType, 'semi-detached_house');
  assert.equal(ok({ ...valid, propertyType: 'Detached House' }).propertyType, 'detached_house'); // legacy
  assert.equal(ok({ ...valid, propertyType: 'Castle' }).propertyType, 'flat');
});

test('money fields reject zero, negatives and silly values', () => {
  assert.equal(ok({ ...valid, purchasePrice: 250000 }).askingPrice, 250000);
  assert.equal(ok({ ...valid, purchasePrice: 0 }).askingPrice, null);
  assert.equal(ok({ ...valid, purchasePrice: -5 }).askingPrice, null);
  assert.equal(ok({ ...valid, purchasePrice: 50_000_001 }).askingPrice, null);
  assert.equal(ok({ ...valid, advertisedRent: 1200 }).rentPcm, 1200);
  assert.equal(ok({ ...valid, advertisedRent: 50_001 }).rentPcm, null);
  assert.equal(ok({ ...valid, purchasePrice: '250000' }).askingPrice, null); // strings are not money
});

test('a source listing carries the asking price only for a sale', () => {
  const sale = ok({ ...valid, purchasePrice: 250000, sourceListing: { url: 'https://www.rightmove.co.uk/properties/91877934', kind: 'sale' } });
  assert.deepEqual(sale.sourceListing?.price, { amount: 250000, period: 'total' });
  const rent = ok({ ...valid, advertisedRent: 1200, sourceListing: { url: 'https://www.rightmove.co.uk/properties/91877934', kind: 'rent' } });
  assert.deepEqual(rent.sourceListing?.price, { amount: 1200, period: 'pcm' });
  // A sale price must not be attached to a rent listing.
  const mixed = ok({ ...valid, purchasePrice: 250000, sourceListing: { url: 'https://www.rightmove.co.uk/properties/91877934', kind: 'rent' } });
  assert.equal(mixed.sourceListing?.price, undefined);
});

test('an unrecognised listing URL yields no source rather than an error', () => {
  assert.equal(ok({ ...valid, sourceListing: { url: 'https://example.com/nope' } }).sourceListing, null);
  assert.equal(ok({ ...valid, sourceListing: 'not-an-object' }).sourceListing, null);
});

test('only an http(s)-safe photo and a uuid checked-listing id survive', () => {
  const i = ok({
    ...valid,
    sourceListing: { url: 'https://www.rightmove.co.uk/properties/91877934', photo: 'javascript:alert(1)' },
    checkedListingId: 'not-a-uuid',
  });
  assert.equal(i.sourceListing?.photo, undefined);
  assert.equal(i.checkedListingId, null);
  assert.equal(ok({ ...valid, checkedListingId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).checkedListingId, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
});

test('enhanced is reported as asked for; the kill switch is the caller’s', () => {
  assert.equal(ok({ ...valid, enhanced: true }).enhancedRequested, true);
  assert.equal(ok({ ...valid, enhanced: 'true' }).enhancedRequested, false); // strictly boolean
  assert.equal(ok(valid).enhancedRequested, false);
});

test('email is kept only when it looks like an address', () => {
  assert.equal(ok({ ...valid, email: ' me@example.com ' }).email, 'me@example.com');
  assert.equal(ok({ ...valid, email: 'nope' }).email, null);
});

test('a non-object body is rejected, not thrown', () => {
  assert.equal(parseAnalysisInput(null).ok, false);
  assert.equal(parseAnalysisInput('string').ok, false);
});
