import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCohortRow, mergeCohortMembers, matchKeys, indexCohorts, lookupCohorts,
  tidyPostcode, COHORT_SLUGS, DEFAULT_COHORTS, isCohortKey, type CohortMember,
} from './cohorts.ts';

test('a row is read through whichever spelling the feed happens to use', () => {
  // The response shape is undocumented, so each field is tried under several
  // plausible names rather than assumed.
  const a = parseCohortRow({ address: '12 High St, Oxford', postcode: 'OX3 9DW', price: 250000, bedrooms: 3, months_on_market: 14 }, 'slow_to_sell')!;
  assert.equal(a.monthsOnMarket, 14);
  assert.equal(a.postcode, 'OX3 9DW');
  const b = parseCohortRow({ full_address: '12 High St', post_code: 'ox39dw', asking_price: '£250,000', num_bedrooms: '3', monthsOnMarket: '14' }, 'slow_to_sell')!;
  assert.equal(b.monthsOnMarket, 14);
  assert.equal(b.price, 250000);
  assert.equal(b.bedrooms, 3);
  assert.equal(b.postcode, 'OX3 9DW');
});

test('a row with nothing to identify it by is unusable', () => {
  // It could neither be sent as a pick nor matched to anything we hold.
  assert.equal(parseCohortRow({ price: 250000 }, 'slow_to_sell'), null);
  assert.equal(parseCohortRow(null, 'slow_to_sell'), null);
  assert.equal(parseCohortRow('x', 'slow_to_sell'), null);
});

test('a postcode is found in an address when there is no postcode field', () => {
  assert.equal(tidyPostcode('12 High St, Oxford, OX3 9DW'), 'OX3 9DW');
  assert.equal(tidyPostcode('ox39dw'), 'OX3 9DW');
  assert.equal(tidyPostcode('nowhere'), null);
  assert.equal(tidyPostcode(null), null);
});

test('a property is matched on uprn, or on postcode and building number', () => {
  assert.deepEqual(matchKeys({ uprn: '100031234567' }), ['uprn:100031234567']);
  assert.deepEqual(matchKeys({ postcode: 'OX3 9DW', address: '12 High St' }), ['pc:OX39DW:12']);
  assert.deepEqual(matchKeys({ address: 'Flat 4, 12 High St, OX3 9DW' }), ['pc:OX39DW:4']);
  // Nothing to key on is no key, not a key that matches everything.
  assert.deepEqual(matchKeys({ address: 'The Old Rectory, Oxford' }), []);
});

test('one property in several cohorts is one entry carrying all of them', () => {
  const rows: CohortMember[] = [
    parseCohortRow({ uprn: '1', address: '12 High St', postcode: 'OX3 9DW', months_on_market: 14 }, 'slow_to_sell')!,
    parseCohortRow({ uprn: '1', address: '12 High St', postcode: 'OX3 9DW', reduced_by: 22 }, 'price_reduced')!,
  ];
  const merged = mergeCohortMembers(rows);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].cohorts.sort(), ['price_reduced', 'slow_to_sell']);
  // The cohort that carries a measurement is the one that took it, so both survive.
  assert.equal(merged[0].monthsOnMarket, 14);
  assert.equal(merged[0].reducedByPct, 22);
});

test('different properties are not merged', () => {
  const rows = [
    parseCohortRow({ uprn: '1', address: '12 High St', postcode: 'OX3 9DW' }, 'slow_to_sell')!,
    parseCohortRow({ uprn: '2', address: '14 High St', postcode: 'OX3 9DW' }, 'slow_to_sell')!,
  ];
  assert.equal(mergeCohortMembers(rows).length, 2);
});

test('a listing finds itself in the feed by either key', () => {
  const index = indexCohorts(mergeCohortMembers([
    parseCohortRow({ uprn: '100031234567', address: '12 High St', postcode: 'OX3 9DW', months_on_market: 18 }, 'slow_to_sell')!,
  ]));
  assert.equal(lookupCohorts(index, { uprn: '100031234567' })?.monthsOnMarket, 18);
  assert.equal(lookupCohorts(index, { postcode: 'OX3 9DW', address: '12 High Street, Oxford' })?.monthsOnMarket, 18);
  assert.equal(lookupCohorts(index, { postcode: 'OX3 9DW', address: '99 Other Road' }), null);
  assert.equal(lookupCohorts(index, {}), null);
});

test('every cohort has at least one slug to try and the defaults are real', () => {
  for (const [key, slugs] of Object.entries(COHORT_SLUGS)) {
    assert.ok(isCohortKey(key));
    assert.ok(slugs.length > 0, key);
    for (const s of slugs) assert.match(s, /^[a-z-]+$/, `${key}: ${s}`);
  }
  for (const c of DEFAULT_COHORTS) assert.ok(isCohortKey(c), c);
  assert.ok(!isCohortKey('not_a_cohort'));
});
