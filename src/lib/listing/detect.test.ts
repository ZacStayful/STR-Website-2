import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectListingUrl } from './detect.ts';

test('rightmove property URLs with tracking junk canonicalise', () => {
  const d = detectListingUrl('https://www.rightmove.co.uk/properties/91877934#/?channel=RES_BUY&utm_source=share');
  assert.deepEqual(d, { source: 'rightmove', id: '91877934', canonicalUrl: 'https://www.rightmove.co.uk/properties/91877934' });
});

test('onthemarket details with or without trailing slash', () => {
  assert.equal(detectListingUrl('onthemarket.com/details/19535441')?.canonicalUrl, 'https://www.onthemarket.com/details/19535441/');
  assert.equal(detectListingUrl('https://www.onthemarket.com/details/19535441/?x=1')?.id, '19535441');
});

test('zoopla sale and rent detail pages', () => {
  assert.equal(detectListingUrl('https://www.zoopla.co.uk/to-rent/details/70123456/')?.source, 'zoopla');
  assert.equal(detectListingUrl('https://www.zoopla.co.uk/for-sale/details/70123456?search_identifier=abc')?.id, '70123456');
});

test('airbnb rooms across country domains', () => {
  assert.equal(detectListingUrl('https://www.airbnb.com/rooms/1115704756752582530?adults=2')?.canonicalUrl, 'https://www.airbnb.co.uk/rooms/1115704756752582530');
  assert.equal(detectListingUrl('https://airbnb.co.uk/rooms/plus/123')?.id, '123');
});

test('booking.com hotel pages keep country and slug', () => {
  const d = detectListingUrl('https://www.booking.com/hotel/gb/the-lace-market-hotel.en-gb.html?aid=1');
  assert.deepEqual(d, { source: 'booking', id: 'gb/the-lace-market-hotel', canonicalUrl: 'https://www.booking.com/hotel/gb/the-lace-market-hotel.html' });
});

test('search pages, other sites and garbage are rejected', () => {
  assert.equal(detectListingUrl('https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E904'), null);
  assert.equal(detectListingUrl('https://www.onthemarket.com/for-sale/property/ng1/'), null);
  assert.equal(detectListingUrl('https://example.com/properties/123'), null);
  assert.equal(detectListingUrl('not a url'), null);
  assert.equal(detectListingUrl('javascript:alert(1)'), null);
  assert.equal(detectListingUrl(''), null);
});
