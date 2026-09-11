import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseListing } from './index.ts';
import { parseAirbnbSummary } from './airbnb.ts';
import { rightmovePageModel } from './rightmove.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '..', '__fixtures__', name), 'utf8');
const NOW = '2026-09-06T12:00:00.000Z';

test('rightmove sale page', () => {
  const s = parseListing('rightmove', fixture('rightmove-sale.html'), { id: '91877934', canonicalUrl: 'https://www.rightmove.co.uk/properties/91877934', now: NOW })!;
  assert.ok(s);
  assert.equal(s.kind, 'sale');
  assert.equal(s.title, '2 bedroom apartment for sale in Labrador Quay, Salford, Lancashire, M50');
  assert.equal(s.displayAddress, 'Labrador Quay, Salford, Lancashire, M50');
  assert.equal(s.postcode, 'M50 3YH');
  assert.equal(s.outcode, 'M50');
  assert.equal(s.lat, 53.473318);
  assert.equal(s.lng, -2.287067);
  assert.equal(s.bedrooms, 2);
  assert.equal(s.bathrooms, 1);
  assert.equal(s.rawType, 'Apartment');
  assert.deepEqual(s.price, { amount: 220000, period: 'total' });
  assert.equal(s.tenure, 'leasehold');
  assert.equal(s.councilTaxBand, 'D');
  assert.ok(s.features.includes('Residents Parking'));
  assert.ok(s.photos[0]?.startsWith('https://media.rightmove.co.uk/'));
  assert.equal(s.status, 'available');
  assert.equal(s.locationConfidence, 'exact');
  assert.equal(s.fetchedAt, NOW);
  assert.equal(s.parserVersion, 1);
  // Agent details never make it into the snapshot.
  assert.ok(!JSON.stringify(s).includes('REDACTED'));
});

test('rightmove rental page', () => {
  const s = parseListing('rightmove', fixture('rightmove-rent.html'), { id: '92783205', canonicalUrl: 'https://www.rightmove.co.uk/properties/92783205', now: NOW })!;
  assert.equal(s.kind, 'rent');
  assert.equal(s.postcode, 'M4 5AE');
  assert.deepEqual(s.price, { amount: 1195, period: 'pcm' });
  assert.equal(s.bathrooms, 2);
  assert.equal(s.councilTaxBand, 'C');
  assert.equal(s.tenure, undefined);
  assert.ok(s.features.includes('Furnished'));
});

test('rightmove page model decodes the flattened data string', () => {
  const p = rightmovePageModel(fixture('rightmove-sale.html'))!;
  assert.equal(p.id, '91877934');
  assert.equal(p.transactionType, 'BUY');
});

test('rightmove falls back to meta tags when PAGE_MODEL is missing', () => {
  const html = '<html><head><title>3 bedroom semi-detached house for sale in Some Road, Leeds, LS6</title><meta property="og:image" content="https://x/y.jpg"></head><body></body></html>';
  const s = parseListing('rightmove', html, { id: '1', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.outcode, 'LS6');
  assert.equal(s.locationConfidence, 'outcode');
  assert.deepEqual(s.photos, ['https://x/y.jpg']);
});

test('onthemarket sale page', () => {
  const s = parseListing('onthemarket', fixture('onthemarket-sale.html'), { id: '19535441', canonicalUrl: 'https://www.onthemarket.com/details/19535441/', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.displayAddress, 'Woolpack Lane, Nottingham');
  assert.equal(s.lat, 52.953246);
  assert.equal(s.bedrooms, 2);
  assert.equal(s.bathrooms, 2);
  assert.equal(s.rawType, 'Flat');
  assert.deepEqual(s.price, { amount: 120000, period: 'total' });
  assert.equal(s.tenure, 'leasehold');
  assert.equal(s.councilTaxBand, 'D');
  assert.ok(s.features.includes('Two double bedrooms'));
  assert.equal(s.status, 'available');
  assert.ok(!JSON.stringify(s).includes('Example Agent'));
});

test('onthemarket rental page (student let, pcm with pw in brackets)', () => {
  const s = parseListing('onthemarket', fixture('onthemarket-rent.html'), { id: '16664769', canonicalUrl: 'https://www.onthemarket.com/details/16664769/', now: NOW })!;
  assert.equal(s.kind, 'rent');
  assert.equal(s.postcode, 'NG1 5JS');
  assert.deepEqual(s.price, { amount: 2054, period: 'pcm' });
  assert.equal(s.bedrooms, 3);
  assert.equal(s.councilTaxBand, 'B');
  assert.ok(s.features.includes('Student let'));
});

test('airbnb entire home page', () => {
  const s = parseListing('airbnb', fixture('airbnb-entire-home.html'), { id: '1115704756752582530', canonicalUrl: 'https://www.airbnb.co.uk/rooms/1115704756752582530', now: NOW })!;
  assert.equal(s.kind, 'str');
  assert.ok(s.title.includes('Cosy House for 8'));
  assert.equal(s.displayAddress, 'Greater Manchester');
  assert.equal(s.lat, 53.4539);
  assert.equal(s.lng, -2.15971);
  assert.equal(s.bedrooms, 4);
  assert.equal(s.bathrooms, 2);
  assert.equal(s.guests, 8);
  assert.equal(s.rawType, 'Entire home/apt');
  assert.equal(s.str?.rating, 4.91);
  assert.equal(s.str?.reviewCount, 74);
  assert.equal(s.str?.isSuperhost, true);
  assert.equal(s.postcode, undefined);
  assert.equal(s.locationConfidence, 'none');
  assert.ok(s.photos[0]?.includes('muscache'));
});

test('airbnb summary parser handles studio and shared baths', () => {
  assert.deepEqual(parseAirbnbSummary('Flat in Leeds · ★4.6 · Studio · 1 bed · 1 shared bathroom'), { place: 'Leeds', rating: 4.6, bedrooms: 0, beds: 1, bathrooms: 1 });
  assert.deepEqual(parseAirbnbSummary(null), {});
});

test('zoopla page via __NEXT_DATA__', () => {
  const s = parseListing('zoopla', fixture('zoopla-sale.html'), { id: '70123456', canonicalUrl: 'https://www.zoopla.co.uk/for-sale/details/70123456/', now: NOW })!;
  assert.equal(s.kind, 'sale');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.bedrooms, 2);
  assert.equal(s.lat, 52.9532);
  assert.deepEqual(s.price, { amount: 125000, period: 'total' });
  assert.equal(s.status, 'under_offer');
  assert.equal(s.tenure, 'leasehold');
  assert.ok(s.features.includes('Allocated parking'));
});

test('booking.com page via JSON-LD', () => {
  const s = parseListing('booking', fixture('booking-hotel.html'), { id: 'gb/example-apartments', canonicalUrl: 'https://www.booking.com/hotel/gb/example-apartments.html', now: NOW })!;
  assert.equal(s.kind, 'str');
  assert.equal(s.title, 'Example Apartments');
  assert.equal(s.postcode, 'NG1 1GH');
  assert.equal(s.lat, 52.9536);
  assert.equal(s.str?.rating, 4.3);
  assert.equal(s.str?.reviewCount, 412);
  assert.deepEqual(s.price, { amount: 95, period: 'night' });
});

test('unreadable pages yield null rather than throwing', () => {
  assert.equal(parseListing('rightmove', '', { id: '1', canonicalUrl: 'x', now: NOW }), null);
  assert.equal(parseListing('airbnb', '<html></html>', { id: '1', canonicalUrl: 'x', now: NOW }), null);
});
