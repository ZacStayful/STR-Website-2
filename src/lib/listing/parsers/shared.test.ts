import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromCompactDate, isoFromUkDate, parseListingUpdate } from './shared.ts';

test('compact portal dates become ISO', () => {
  assert.equal(isoFromCompactDate('20260811'), '2026-08-11');
  assert.equal(isoFromCompactDate('20260101'), '2026-01-01');
});

test('UK dates are read day-first', () => {
  // 11/08 is 11 August, never 8 November. Reading it the American way would
  // put a three-month error straight into days on market.
  assert.equal(isoFromUkDate('11/08/2026'), '2026-08-11');
  assert.equal(isoFromUkDate('3/6/2026'), '2026-06-03');
  assert.equal(isoFromUkDate('30-09-2026'), '2026-09-30');
});

test('a date that does not exist is not a date', () => {
  for (const v of ['20260231', '20261301', '20260000']) assert.equal(isoFromCompactDate(v), null, v);
  for (const v of ['31/02/2026', '32/01/2026', '01/13/2026']) assert.equal(isoFromUkDate(v), null, v);
});

test('junk gives null rather than a guess', () => {
  for (const v of [null, undefined, '', 'soon', 42, '2026-08-11']) {
    assert.equal(isoFromCompactDate(v), null, JSON.stringify(v));
  }
  for (const v of [null, undefined, '', 'yesterday', '11/08/26']) {
    assert.equal(isoFromUkDate(v), null, JSON.stringify(v));
  }
});

test('listing updates carry what happened and when', () => {
  assert.deepEqual(parseListingUpdate('Added on 11/08/2026'), { reason: 'added', on: '2026-08-11' });
  assert.deepEqual(parseListingUpdate('Reduced on 03/06/2026'), { reason: 'reduced', on: '2026-06-03' });
  assert.deepEqual(parseListingUpdate('Increased on 03/06/2026'), { reason: 'increased', on: '2026-06-03' });
});

test('relative wording resolves against the fetch date, not the clock', () => {
  assert.deepEqual(parseListingUpdate('Added yesterday', '2026-09-06'), { reason: 'added', on: '2026-09-05' });
  assert.deepEqual(parseListingUpdate('Reduced today', '2026-09-06'), { reason: 'reduced', on: '2026-09-06' });
  // Across a month boundary.
  assert.deepEqual(parseListingUpdate('Added yesterday', '2026-09-01'), { reason: 'added', on: '2026-08-31' });
});

test('a known event with an unreadable date keeps the event', () => {
  // "Reduced" still means reduced even when we cannot date it.
  assert.deepEqual(parseListingUpdate('Added yesterday'), { reason: 'added', on: null });
  assert.deepEqual(parseListingUpdate('Reduced last week', '2026-09-06'), { reason: 'reduced', on: null });
});

test('wording we do not recognise is not an event', () => {
  for (const v of [null, undefined, '', 'Featured property', 'New home']) {
    assert.equal(parseListingUpdate(v), null, JSON.stringify(v));
  }
});
