import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealRowTitle, dealWhere } from './row-title.ts';

const card = { town: 'Leeds', postcode_area: 'LS', outcode: 'LS6' };

test('an unopened marketplace deal never shows an address, wherever one is known', () => {
  const t = dealRowTitle({ opened: false, listing: { title: '1 High St', address: '1 High St, Leeds LS6 1AA' } }, card, '1 High St, Leeds LS6 1AA');
  assert.equal(t, dealWhere(card));
  assert.doesNotMatch(t, /High St/);
});

test('an opened deal shows its address: the row first, then the loaded one, then where it is', () => {
  assert.equal(dealRowTitle({ opened: true, listing: { title: 'x', address: 'Row address' } }, card, 'Loaded'), 'Row address');
  assert.equal(dealRowTitle({ opened: true, listing: null }, card, 'Loaded'), 'Loaded');
  assert.equal(dealRowTitle({ opened: true, listing: null }, card, null), dealWhere(card));
});

test('a listing the member added is theirs: its address or its title', () => {
  assert.equal(dealRowTitle({ opened: true, listing: { title: 'Flat', address: '2 Low Rd' } }, null, null), '2 Low Rd');
  assert.equal(dealRowTitle({ opened: true, listing: { title: 'Flat', address: null } }, null, null), 'Flat');
  assert.equal(dealRowTitle({ opened: false, listing: null }, null, null), 'Listing');
});

test('where a deal is: town, area and outcode, never empty', () => {
  assert.match(dealWhere(card), /^Leeds/);
  assert.match(dealWhere(card), /LS6$/);
  assert.equal(dealWhere({ town: null, postcode_area: null, outcode: null }), 'Location on the sheet');
});
