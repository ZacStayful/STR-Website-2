import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intelligenceStats } from './admin.ts';

test('reveal and search figures', () => {
  const s = intelligenceStats(
    [
      { viewed_at: 'x', first_keep_ms: 4000, strong: true, no_match: false, layer: null },
      { viewed_at: 'x', first_keep_ms: 20000, strong: false, no_match: false, layer: 2 },
      { viewed_at: 'x', first_keep_ms: null, strong: false, no_match: true, layer: null },
      { viewed_at: null, first_keep_ms: null, strong: false, no_match: false, layer: null },
    ],
    [
      { purpose: 'signup', status: 'done', raw_pence: 12.5, charged_base_pence: 0, found: 2, confirmed: 1 },
      { purpose: 'deep', status: 'done', raw_pence: 40, charged_base_pence: 200, found: 3, confirmed: 3 },
    ],
  );
  assert.equal(s.reveals, 4);
  assert.equal(s.viewed, 3);
  assert.equal(s.medianFirstKeepMs, 12000);
  assert.equal(s.under10s, 50);
  assert.equal(s.noMatchShare, 33.3);
  assert.deepEqual(s.byLayer, { stock: 1, 'layer 2': 1, none: 1 });
  assert.equal(s.signupSearches.perSignupPence, 3.13);
  assert.equal(s.deepSearches.revenuePence, 200);
});
