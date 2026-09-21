import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGbp, formatGbpSigned, formatPercent, formatRating, formatRatingPlain,
  formatGbpCompact, formatIssued, outwardCode, splitAddress,
} from './format.ts';

// These four moved out of Chrome.tsx, which two other documents still import
// them from. Their output must not have changed.
test('money and percentages format as they always did', () => {
  assert.equal(formatGbp(17810), '£17,810');
  assert.equal(formatGbp(1484.6), '£1,485');
  assert.equal(formatGbpSigned(9246), '+£9,246');
  assert.equal(formatGbpSigned(-771), '−£771');
  assert.equal(formatGbpSigned(0), '+£0');
  assert.equal(formatPercent(0.57), '57%');
  assert.equal(formatRating(4.8), '4.8 ★');
  assert.equal(formatRating(0), '—');
});

test('the new report prints ratings without a star', () => {
  // The approved design shows ratings bare. Inter has U+2605; this is a
  // design decision rather than a font limitation.
  assert.equal(formatRatingPlain(4.8), '4.8');
  assert.equal(formatRatingPlain(5), '5.0');
  assert.equal(formatRatingPlain(0), '—');
});

test('compact money keeps a twelve-column axis legible', () => {
  assert.equal(formatGbpCompact(0), '£0');
  assert.equal(formatGbpCompact(500), '£500');
  assert.equal(formatGbpCompact(1000), '£1k');
  assert.equal(formatGbpCompact(1500), '£1.5k');
  assert.equal(formatGbpCompact(2000), '£2k');
  assert.equal(formatGbpCompact(Number.NaN), '—');
});

test('the issued date comes from the report, not the clock', () => {
  assert.equal(formatIssued('2026-02-03T09:00:00Z'), '03.02.2026');
  assert.equal(formatIssued('2026-12-25T23:59:59Z'), '25.12.2026');
  assert.equal(formatIssued('not a date'), null);
  assert.equal(formatIssued(null), null);
  assert.equal(formatIssued(undefined), null);
});

test('outward codes are recognised, junk is not', () => {
  assert.equal(outwardCode('LE1 6TE'), 'LE1');
  assert.equal(outwardCode('le1 6te'), 'LE1');
  assert.equal(outwardCode('EC1A 1BB'), 'EC1A');
  assert.equal(outwardCode('M1 1AE'), 'M1');
  assert.equal(outwardCode(''), '');
  assert.equal(outwardCode(null), '');
  assert.equal(outwardCode('banana'), '');
});

test('an address splits into a street line and a town', () => {
  assert.deepEqual(
    splitAddress('22 Princess Road West, Leicester, LE1 6TE, UK', 'LE1 6TE'),
    { line1: '22 Princess Road West', locality: 'Leicester' },
  );
  assert.deepEqual(
    splitAddress('1 High Street, Didsbury, Manchester', 'M20 2DN'),
    { line1: '1 High Street, Didsbury', locality: 'Manchester' },
  );
});

test('country suffixes are not mistaken for the town', () => {
  assert.equal(splitAddress('5 Mill Lane, Bath, England', 'BA1 1AA').locality, 'Bath');
  assert.equal(splitAddress('5 Mill Lane, Bath, United Kingdom', 'BA1 1AA').locality, 'Bath');
});

test('a one-part address falls back to the outward code', () => {
  assert.deepEqual(
    splitAddress('Rose Cottage', 'YO62 5UY'),
    { line1: 'Rose Cottage', locality: 'YO62' },
  );
  // Nothing usable at all: the page prints the address alone rather than a stray separator.
  assert.deepEqual(splitAddress('Rose Cottage', null), { line1: 'Rose Cottage', locality: '' });
  assert.deepEqual(splitAddress('', null), { line1: '', locality: '' });
});
