import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealHeadline, dealShort, placeOf, roundToFifty, savedForYouLine, whatOf, type DealDescription } from './copy.ts';

const flat: DealDescription = { bedrooms: 2, propertyKind: 'flat', dealType: 'r2r', town: 'HARROGATE', postcodeArea: 'HG', range: { lowPcm: 1110, highPcm: 1290 }, basis: 'range' };

test('the headline: what, where, and a rounded range — never a price or a postcode', () => {
  assert.equal(dealHeadline(flat, 'speech'), 'a 2-bed flat to rent in Harrogate that could make around 1,100 to 1,300 pounds a month');
  assert.equal(dealHeadline(flat, 'text'), 'a 2-bed flat to rent in Harrogate that could make around £1,100–£1,300 a month');
  assert.doesNotMatch(dealHeadline(flat, 'text'), /HG|\d[A-Z]{2}\b/);
});

test('a BRRR project is "after the works", and "refinanced" for a full one', () => {
  const p: DealDescription = { ...flat, dealType: 'brrr', propertyKind: 'house', bedrooms: 3, basis: 'after_works' };
  assert.equal(whatOf(p), '3-bed project');
  assert.match(dealHeadline(p, 'speech'), /3-bed project in Harrogate that could make around .* once the works are done$/);
  assert.match(dealHeadline({ ...p, basis: 'after_refinance' }, 'speech'), /once the works are done and it's refinanced$/);
});

test('a short-let sale reads as the property', () => {
  assert.equal(whatOf({ bedrooms: 1, propertyKind: 'house', dealType: 'buy_str' }), '1-bed house');
  assert.equal(whatOf({ bedrooms: null, propertyKind: 'unknown', dealType: 'buy_str' }), 'property');
});

test('the place: the town, else the area name, never a postcode-looking town', () => {
  assert.equal(placeOf({ town: 'KINGSTON UPON THAMES', postcodeArea: 'KT' }), 'Kingston Upon Thames');
  assert.equal(placeOf({ town: 'HG1 2AB', postcodeArea: null }), null);
  assert.equal(placeOf({ town: null, postcodeArea: 'ZZ' }), null);
});

test('the short name a text or callback uses', () => {
  assert.equal(dealShort(flat), 'the 2-bed in Harrogate');
  assert.equal(dealShort({ ...flat, town: null, postcodeArea: null }), 'the 2-bed I found');
});

test('ranges are rounded to the nearest £50', () => {
  assert.equal(roundToFifty(1124), 1100);
  assert.equal(roundToFifty(1125), 1150);
  assert.equal(dealHeadline({ ...flat, range: { lowPcm: 1210, highPcm: 1230 } }, 'text'), 'a 2-bed flat to rent in Harrogate that could make around £1,200–£1,250 a month');
});

test('the "Saved for you" line', () => {
  assert.equal(savedForYouLine(flat), '2-bed flat to rent in Harrogate · could make £1,100–£1,300 a month');
});
