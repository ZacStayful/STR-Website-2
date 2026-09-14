import { test } from 'node:test';
import assert from 'node:assert/strict';
import { districtLabel, districtMatches, marketSubtitle, marketTitle, subMarketSubtitle, subMarketTitle } from './labels.ts';

const leicester = { code: 'LE', name: 'Leicester', region: { name: 'East Midlands' } };
const le2 = { code: 'LE2', locality: 'Clarendon Park', localities: ['Clarendon Park', 'Knighton', 'Stoneygate', 'Aylestone', 'Oadby'] };
const le99 = { code: 'LE99', locality: null, localities: [] };
const le11 = { code: 'LE11', locality: 'Loughborough', localities: ['Loughborough'] };

test('a market is titled as a place with the code in the subtitle', () => {
  assert.equal(marketTitle(leicester), 'Leicester');
  assert.equal(marketSubtitle(leicester), 'LE postcode area · East Midlands');
});

test('a sub-market with a locality is "Place · Locality"; the subtitle carries the code and the other localities', () => {
  assert.equal(subMarketTitle(leicester, le2), 'Leicester · Clarendon Park');
  assert.equal(subMarketSubtitle(le2), 'LE2 postcode district · also Knighton, Stoneygate, Aylestone & 1 more');
  assert.equal(subMarketSubtitle(le2, 10), 'LE2 postcode district · also Knighton, Stoneygate, Aylestone, Oadby');
  assert.equal(subMarketSubtitle(le11), 'LE11 postcode district');
});

test('a district with no locality on file falls back to "Place CODE"', () => {
  assert.equal(subMarketTitle(leicester, le99), 'Leicester LE99');
  assert.equal(subMarketSubtitle(le99), 'LE99 postcode district');
  assert.equal(districtLabel(le99), 'LE99');
});

test('the short label is "Locality (CODE)"', () => {
  assert.equal(districtLabel(le2), 'Clarendon Park (LE2)');
});

test('search matches the code prefix or any locality, case-insensitively via a lower-cased term', () => {
  assert.ok(districtMatches(le2, 'le2'));
  assert.ok(districtMatches(le2, 'le'));
  assert.ok(districtMatches(le2, 'clarendon'));
  assert.ok(districtMatches(le2, 'oadby'));
  assert.ok(!districtMatches(le2, 'lough'));
  assert.ok(districtMatches(le99, ''));
  assert.ok(!districtMatches(le99, 'clarendon'));
});
