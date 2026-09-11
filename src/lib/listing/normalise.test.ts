import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotToPrefill, mapPropertyType, parkingFromFeatures, outdoorFromFeatures, pcmFromPrice, defaultGuests } from './normalise.ts';
import type { ListingSnapshot } from './types.ts';

function snap(over: Partial<ListingSnapshot>): ListingSnapshot {
  return {
    source: 'rightmove', id: '1', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', fetchedAt: '2026-09-06T00:00:00.000Z', parserVersion: 1,
    kind: 'sale', title: 'x', features: [], photos: [], locationConfidence: 'exact', ...over,
  };
}

test('property type mapping covers portal and Airbnb wording', () => {
  assert.equal(mapPropertyType('Apartment'), 'Flat');
  assert.equal(mapPropertyType('Maisonette'), 'Flat');
  assert.equal(mapPropertyType('Semi-Detached'), 'Semi-detached');
  assert.equal(mapPropertyType('End of Terrace'), 'Terraced');
  assert.equal(mapPropertyType('Town House'), 'Terraced');
  assert.equal(mapPropertyType('Bungalow'), 'Detached');
  assert.equal(mapPropertyType('Entire home/apt'), 'Detached');
  assert.equal(mapPropertyType('Entire rental unit'), 'Flat');
  assert.equal(mapPropertyType(undefined, 1), 'Flat');
  assert.equal(mapPropertyType(undefined, 3), 'Terraced');
});

test('parking and outdoor space inferred from features', () => {
  assert.equal(parkingFromFeatures(['Residents Parking', 'Juliet balcony']), 'allocated');
  assert.equal(parkingFromFeatures(['Garage and driveway']), 'garage');
  assert.equal(parkingFromFeatures(['Driveway for two cars']), 'driveway_2');
  assert.equal(parkingFromFeatures(['Off street parking']), 'driveway_1');
  assert.equal(parkingFromFeatures(['Lovely views']), 'no_parking');
  assert.equal(outdoorFromFeatures(['Juliet balcony']), 'balcony');
  assert.equal(outdoorFromFeatures(['Private rear garden']), 'garden');
  assert.equal(outdoorFromFeatures(['Roof terrace']), 'roof_terrace');
  assert.equal(outdoorFromFeatures([]), 'none');
});

test('weekly rent converts to monthly', () => {
  assert.equal(pcmFromPrice({ amount: 276, period: 'pw' }), 1196);
  assert.equal(pcmFromPrice({ amount: 1195, period: 'pcm' }), 1195);
  assert.equal(pcmFromPrice({ amount: 220000, period: 'total' }), null);
  assert.equal(defaultGuests(2), 6);
  assert.equal(defaultGuests(9), 16);
});

test('sale listing prefill carries the asking price', () => {
  const { prefill, warnings } = snapshotToPrefill(snap({ displayAddress: 'Labrador Quay, Salford, M50', postcode: 'M50 3YH', bedrooms: 2, bathrooms: 1, rawType: 'Apartment', price: { amount: 220000, period: 'total' }, features: ['Residents Parking', 'Juliet balcony'] }));
  assert.equal(prefill.address, 'Labrador Quay, Salford, M50');
  assert.equal(prefill.postcode, 'M50 3YH');
  assert.equal(prefill.bedrooms, 2);
  assert.equal(prefill.guests, 6);
  assert.equal(prefill.propertyType, 'Flat');
  assert.equal(prefill.parking, 'allocated');
  assert.equal(prefill.outdoorSpace, 'balcony');
  assert.equal(prefill.purchasePrice, 220000);
  assert.equal(prefill.advertisedRent, undefined);
  assert.deepEqual(warnings, []);
});

test('rental listing prefill carries pcm rent and warns on student lets', () => {
  const { prefill, warnings } = snapshotToPrefill(snap({ kind: 'rent', postcode: 'NG1 5JS', bedrooms: 3, price: { amount: 474, period: 'pw' }, features: ['Student let'] }));
  assert.equal(prefill.advertisedRent, 2054);
  assert.equal(prefill.purchasePrice, undefined);
  assert.ok(warnings.some((w) => /student/i.test(w)));
});

test('airbnb listing without postcode warns and keeps coordinates out of the address', () => {
  const { prefill, warnings } = snapshotToPrefill(snap({ source: 'airbnb', kind: 'str', title: 'Cosy House for 8', displayAddress: 'Greater Manchester', bedrooms: 4, bathrooms: 2, guests: 8, rawType: 'Entire home/apt', locationConfidence: 'none' }));
  assert.equal(prefill.address, 'Cosy House for 8, Greater Manchester');
  assert.equal(prefill.postcode, '');
  assert.equal(prefill.guests, 8);
  assert.equal(prefill.propertyType, 'Detached');
  assert.ok(warnings.some((w) => /no postcode/i.test(w)));
});

test('missing bedrooms defaults and warns; values are clamped', () => {
  const { prefill, warnings } = snapshotToPrefill(snap({ postcode: 'M1 1AA', bathrooms: 9, guests: 40 }));
  assert.equal(prefill.bedrooms, 2);
  assert.equal(prefill.bathrooms, 5);
  assert.equal(prefill.guests, 16);
  assert.ok(warnings.some((w) => /bedrooms/i.test(w)));
});
