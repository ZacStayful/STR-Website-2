import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatListingPrice } from './format.ts';

test('formatListingPrice handles periods and compact form', () => {
  assert.equal(formatListingPrice({ amount: 220000, period: 'total' }), '£220,000');
  assert.equal(formatListingPrice({ amount: 1195, period: 'pcm' }), '£1,195 pcm');
  assert.equal(formatListingPrice({ amount: 276, period: 'pw' }), '£276 pw');
  assert.equal(formatListingPrice({ amount: 89, period: 'night' }), '£89 / night');
  assert.equal(formatListingPrice({ amount: 220000, period: 'total' }, true), '£220k');
  assert.equal(formatListingPrice({ amount: 2054, period: 'pcm' }, true), '£2.1k pcm');
  assert.equal(formatListingPrice(null), '—');
});
