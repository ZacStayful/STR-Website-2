import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsOneSegment, gsmLength, isGsm, MAX_SMS_LENGTH, toGsm } from './gsm.ts';

test('plain English, digits and £ are one character each', () => {
  assert.equal(gsmLength('Price drop: £1,050pcm (was £1,150).'), 'Price drop: £1,050pcm (was £1,150).'.length);
  assert.equal(isGsm('Reply STOP to opt out'), true);
});

test('extension characters cost two', () => {
  assert.equal(gsmLength('€'), 2);
  assert.equal(gsmLength('[a]'), 5);
  assert.equal(gsmLength('^{}\\~|'), 12);
});

test('emoji and other non-GSM characters are refused, not counted', () => {
  assert.equal(gsmLength('Great deal 🏠'), null);
  assert.equal(gsmLength('Leeds → York'), null);
  assert.equal(gsmLength('naïve'), null); // ï is not in GSM-7
  assert.equal(isGsm('“quoted”'), false);
});

test('toGsm swaps curly quotes, dashes, ellipses, arrows and odd spaces for plain ones', () => {
  assert.equal(toGsm('Today’s 5 — “kept” deals… 2 bed'), 'Today\'s 5 - "kept" deals... 2 bed');
  assert.equal(toGsm('£1,150 → £1,050'), '£1,150 to £1,050');
  assert.equal(toGsm('4 × 2'), '4 x 2');
  assert.equal(toGsm('a​b'), 'ab');
  assert.equal(isGsm(toGsm('Today’s 5 — “kept” deals…')), true);
});

test('toGsm leaves characters with no plain equivalent for gsmLength to refuse', () => {
  assert.equal(isGsm(toGsm('Nice 🏠')), false);
});

test('one segment means 1 to 160 GSM-7 characters', () => {
  assert.equal(fitsOneSegment('a'.repeat(MAX_SMS_LENGTH)), true);
  assert.equal(fitsOneSegment('a'.repeat(MAX_SMS_LENGTH + 1)), false);
  assert.equal(fitsOneSegment('a'.repeat(MAX_SMS_LENGTH - 1) + '€'), false); // 159 + 2
  assert.equal(fitsOneSegment(''), false);
  assert.equal(fitsOneSegment('hi 😀'), false);
});
