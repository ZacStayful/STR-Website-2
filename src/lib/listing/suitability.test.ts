import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortLetsAllowed, tenureOf, suitabilityFromListing, suitabilityFromSnapshot, stripHtml, MIN_SALE_PRICE } from './suitability.ts';
import type { SourcedListing } from './sourcing.ts';
import type { ListingSnapshot } from './types.ts';

const listing = (over: Partial<SourcedListing> = {}): SourcedListing => ({
  source: 'onthemarket',
  id: '1',
  canonicalUrl: 'https://www.onthemarket.com/details/1/',
  kind: 'sale',
  title: '3 bedroom terraced house for sale',
  address: '1 High Street, Nottingham NG1 1AA',
  postcode: 'NG1 1AA',
  outcode: 'NG1',
  postcodeArea: 'NG',
  lat: null,
  lng: null,
  bedrooms: 3,
  bathrooms: 1,
  price: { amount: 180_000, period: 'total' },
  rawType: 'Terraced house',
  photo: null,
  tenure: null,
  features: [],
  priceQualifier: null,
  sharedOwnership: null,
  shortLetsPermitted: null,
  ...over,
});

const snapshot = (over: Partial<ListingSnapshot> = {}): ListingSnapshot => ({
  source: 'rightmove',
  id: '1',
  canonicalUrl: 'https://www.rightmove.co.uk/properties/1',
  fetchedAt: '2026-09-20T07:00:00.000Z',
  parserVersion: 1,
  kind: 'sale',
  title: '3 bedroom terraced house for sale',
  rawType: 'Terraced',
  price: { amount: 180_000, period: 'total' },
  tenure: 'freehold',
  features: [],
  photos: [],
  locationConfidence: 'none',
  ...over,
});

test('shortLetsAllowed reads permission, prohibition and silence', () => {
  assert.equal(shortLetsAllowed('Short term lets are permitted under the lease.'), true);
  assert.equal(shortLetsAllowed('Ideal Airbnb opportunity. Currently run as a successful holiday let.'), true);
  assert.equal(shortLetsAllowed('Short-term letting is not permitted. Great transport links.'), false);
  assert.equal(shortLetsAllowed('No sub-letting. No pets. No smokers.'), false);
  assert.equal(shortLetsAllowed('Holiday lets welcome. However Airbnb is prohibited by the freeholder.'), false);
  assert.equal(shortLetsAllowed('A lovely two bedroom flat with a balcony.'), null);
  assert.equal(shortLetsAllowed(''), null);
  assert.equal(shortLetsAllowed(null), null);
  assert.equal(shortLetsAllowed('<p>Short term lets<br>are allowed.</p><p>Chain free.</p>'), true);
  assert.equal(stripHtml('<p>a&nbsp;b</p><li>c</li>'), 'a b. c.');
});

test('tenureOf normalises portal wording', () => {
  assert.equal(tenureOf('Tenure: Leasehold (975 years remaining)'), 'leasehold');
  assert.equal(tenureOf('LEASEHOLD'), 'leasehold');
  assert.equal(tenureOf('Share of Freehold'), 'freehold');
  assert.equal(tenureOf('freehold'), 'freehold');
  assert.equal(tenureOf(null, undefined, 'Nearest station 0.1mi.'), null);
  assert.equal(tenureOf(null, 'Tenure: Freehold', 'leasehold'), 'freehold');
});

test('rooms, shares, shared ownership, retirement and park homes are never picks', () => {
  assert.equal(suitabilityFromListing(listing({ kind: 'rent', title: '1 bedroom in a house share to rent', rawType: 'House share', price: { amount: 750, period: 'pcm' } })), 'room');
  assert.equal(suitabilityFromListing(listing({ kind: 'rent', title: 'Double room to rent in Leeds', rawType: 'Room' })), 'room');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom flat for sale', rawType: 'Flat', priceQualifier: 'Shared ownership', tenure: 'leasehold' })), 'shared_ownership');
  assert.equal(suitabilityFromListing(listing({ title: '4 bedroom house for sale (25% share)', price: { amount: 42_000, period: 'total' } })), 'shared_ownership');
  assert.equal(suitabilityFromListing(listing({ title: '4 bedroom house for sale', price: { amount: 42_000, period: 'total' } })), 'low_price');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom retirement apartment for sale', rawType: 'Flat', tenure: 'leasehold' })), 'age_restricted');
  assert.equal(suitabilityFromListing(listing({ title: '1 bedroom flat for sale', features: ['Over 55s only'], tenure: 'freehold' })), 'age_restricted');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom lodge for sale', rawType: 'Park home', features: ['Holiday park'] })), 'park_home');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom house for sale' })), 'ok');
  assert.equal(suitabilityFromListing(listing({ price: { amount: MIN_SALE_PRICE, period: 'total' } })), 'ok');
});

test('leasehold sales need the page, flats count as leasehold until the page says otherwise', () => {
  const lease = listing({ title: '2 bedroom flat for sale', rawType: 'Flat', features: ['Tenure: Leasehold (975 years remaining)'] });
  assert.equal(suitabilityFromListing(lease), 'unknown');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom apartment for sale', rawType: 'Apartment' })), 'unknown');
  assert.equal(suitabilityFromListing(listing({ title: '2 bedroom apartment for sale', rawType: 'Apartment', features: ['Tenure: Share of Freehold'] })), 'ok');
  assert.equal(suitabilityFromListing(listing({ ...lease, features: [...(lease.features ?? []), 'Short term lets permitted'] })), 'ok');
  // A leasehold listing whose page has already been read and was silent is out.
  assert.equal(suitabilityFromListing(listing({ ...lease, sharedOwnership: false, shortLetsPermitted: null })), 'leasehold');
  assert.equal(suitabilityFromListing(listing({ ...lease, sharedOwnership: false, shortLetsPermitted: true })), 'ok');
  assert.equal(suitabilityFromListing(listing({ ...lease, sharedOwnership: true })), 'shared_ownership');
  // A house with tenure unknown is a house: fine before the page.
  assert.equal(suitabilityFromListing(listing({ title: '3 bedroom semi-detached house for sale', rawType: 'Semi-detached house' })), 'ok');
  // Older stored snapshots have none of the new fields.
  const old = listing();
  delete (old as Partial<SourcedListing>).features;
  delete (old as Partial<SourcedListing>).tenure;
  delete (old as Partial<SourcedListing>).sharedOwnership;
  assert.equal(suitabilityFromListing(old), 'ok');
});

test('rentals only fail on rooms and explicit prohibitions', () => {
  assert.equal(suitabilityFromListing(listing({ kind: 'rent', title: '2 bedroom flat to rent', rawType: 'Flat', price: { amount: 1200, period: 'pcm' } })), 'ok');
  assert.equal(suitabilityFromListing(listing({ kind: 'rent', title: '2 bedroom flat to rent', rawType: 'Flat', features: ['No sub-letting'], price: { amount: 1200, period: 'pcm' } })), 'no_short_lets');
  assert.equal(suitabilityFromListing(listing({ kind: 'rent', title: '2 bedroom flat to rent', shortLetsPermitted: false, sharedOwnership: false })), 'no_short_lets');
});

test('suitabilityFromSnapshot is the verdict from the page', () => {
  assert.equal(suitabilityFromSnapshot(snapshot(), 'sale'), 'ok');
  assert.equal(suitabilityFromSnapshot(snapshot({ tenure: 'leasehold', rawType: 'Apartment' }), 'sale'), 'leasehold');
  assert.equal(suitabilityFromSnapshot(snapshot({ tenure: 'leasehold', rawType: 'Apartment', shortLetsPermitted: true }), 'sale'), 'ok');
  assert.equal(suitabilityFromSnapshot(snapshot({ tenure: 'leasehold', rawType: 'Apartment', shortLetsPermitted: false }), 'sale'), 'no_short_lets');
  assert.equal(suitabilityFromSnapshot(snapshot({ tenure: undefined, rawType: 'Flat' }), 'sale'), 'leasehold');
  assert.equal(suitabilityFromSnapshot(snapshot({ tenure: undefined, rawType: 'Detached' }), 'sale'), 'ok');
  assert.equal(suitabilityFromSnapshot(snapshot({ sharedOwnership: true }), 'sale'), 'shared_ownership');
  assert.equal(suitabilityFromSnapshot(snapshot({ price: { amount: 42_000, period: 'total', qualifier: 'Guide price' } }), 'sale'), 'low_price');
  assert.equal(suitabilityFromSnapshot(snapshot({ kind: 'rent', title: 'Room to rent in shared house', price: { amount: 600, period: 'pcm' } }), 'rent'), 'room');
  assert.equal(suitabilityFromSnapshot(snapshot({ kind: 'rent', tenure: undefined, rawType: 'Flat', price: { amount: 1200, period: 'pcm' } }), 'rent'), 'ok');
  assert.equal(suitabilityFromSnapshot(snapshot({ kind: 'rent', shortLetsPermitted: false, price: { amount: 1200, period: 'pcm' } }), 'rent'), 'no_short_lets');
});
