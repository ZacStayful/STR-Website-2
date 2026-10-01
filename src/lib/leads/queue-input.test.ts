import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queuedAnalysisInput } from './queue-input.ts';

const stored = {
  property: { address: '12 Mill Lane', postcode: 'SK9 1AA', bedrooms: 4, guests: 8 },
  email: 'jane@example.com',
  propertyType: 'detached_house',
  bathrooms: 3,
  parkingSpaces: 2,
  hasParking: true,
  outdoorSpace: 'garden',
  askingPrice: 450000,
  rentPcm: null,
  sourceListing: null,
  checkedListingId: null,
  fromDeal: false,
  enhancedRequested: true,
};

test('Batch 21 (C4): a queued lead is re-run as the prospect described the property; the depth is the funnel\'s today', () => {
  const input = queuedAnalysisInput({ address: '12 Mill Lane', postcode: 'SK9 1AA', bedrooms: 4, input: stored }, { enhanced: false });
  assert.ok(input);
  assert.equal(input.propertyType, 'detached_house');
  assert.equal(input.bathrooms, 3);
  assert.equal(input.hasParking, true);
  assert.equal(input.outdoorSpace, 'garden');
  assert.equal(input.property.guests, 8);
  assert.equal(input.enhancedRequested, false, 'the stored depth is not the funnel\'s choice');
});

test('a lead captured before leads.input existed is rebuilt from its three columns, as before', () => {
  for (const input of [undefined, null, 'junk', { property: { address: 'x' } }]) {
    const rebuilt = queuedAnalysisInput({ address: '12 Mill Lane', postcode: 'sk9 1aa', bedrooms: 4, input }, { enhanced: true });
    assert.ok(rebuilt, String(input));
    assert.equal(rebuilt.propertyType, 'flat');
    assert.equal(rebuilt.property.postcode, 'SK9 1AA');
    assert.equal(rebuilt.property.guests, 10);
    assert.equal(rebuilt.enhancedRequested, true);
  }
  assert.equal(queuedAnalysisInput({ address: null, postcode: 'SK9 1AA', bedrooms: 2 }, { enhanced: false }), null);
});
