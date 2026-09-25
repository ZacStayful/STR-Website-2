import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTerm, searchFilter, londonDayStart, londonDateRange } from './search.ts';

test('searchTerm keeps what people actually search for', () => {
  assert.equal(searchTerm('  j.smith@gmail.com '), 'j.smith@gmail.com');
  assert.equal(searchTerm('12 High St'), '12 High St');
  assert.equal(searchTerm('M14 5'), 'M14 5');
  assert.equal(searchTerm("O'Brien"), "O'Brien");
});

test('searchTerm cannot add or group filter clauses', () => {
  const t = searchTerm('x,user_id.neq.0,or(email.ilike.*)');
  assert.ok(t);
  assert.ok(!/[,()*]/.test(t), `unsafe characters survived: ${t}`);
  // The built filter has exactly the four clauses we put there.
  assert.equal(searchFilter(t).split(',').length, 4);
});

test('searchTerm refuses empty, wildcard-only and non-string input', () => {
  assert.equal(searchTerm(''), null);
  assert.equal(searchTerm('   '), null);
  assert.equal(searchTerm('%%%'), null);
  assert.equal(searchTerm('***'), null);
  assert.equal(searchTerm(undefined), null);
  assert.equal(searchTerm(['a']), null);
});

test('searchTerm caps length', () => {
  assert.equal(searchTerm('a'.repeat(500))?.length, 100);
});

test('searchFilter covers email, name, address and postcode', () => {
  assert.equal(
    searchFilter('smith'),
    'email.ilike.%smith%,name.ilike.%smith%,address.ilike.%smith%,postcode.ilike.%smith%',
  );
});

test('a UK day starts at UK midnight, in winter and in summer', () => {
  assert.equal(londonDayStart('2026-01-12')?.toISOString(), '2026-01-12T00:00:00.000Z');
  assert.equal(londonDayStart('2026-07-12')?.toISOString(), '2026-07-11T23:00:00.000Z');
});

test('impossible or malformed dates are refused', () => {
  assert.equal(londonDayStart('2026-02-31'), null);
  assert.equal(londonDayStart('12/03/2026'), null);
  assert.equal(londonDayStart(''), null);
});

test('a date range includes the whole of the last day', () => {
  const summer = londonDateRange('2026-07-12', '2026-07-12');
  assert.equal(summer.since, '2026-07-11T23:00:00.000Z');
  assert.equal(summer.until, '2026-07-12T22:59:59.999Z');

  const winter = londonDateRange(null, '2026-01-12');
  assert.equal(winter.since, null);
  assert.equal(winter.until, '2026-01-12T23:59:59.999Z');
});

test('a range spanning the clock change ends on the right instant', () => {
  // Clocks go forward on 29 Mar 2026; the 29th is a 23-hour day.
  const r = londonDateRange('2026-03-29', '2026-03-29');
  assert.equal(r.since, '2026-03-29T00:00:00.000Z');
  assert.equal(r.until, '2026-03-29T22:59:59.999Z');
});
