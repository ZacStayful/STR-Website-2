import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeInternalPath } from './safe-path.ts';

test('accepts same-origin absolute paths', () => {
  assert.equal(safeInternalPath('/markets', '/estimate'), '/markets');
  assert.equal(safeInternalPath('/markets/manchester?x=1', '/estimate'), '/markets/manchester?x=1');
});

test('falls back for anything else', () => {
  for (const bad of [null, undefined, '', 'markets', 'https://evil.com', '//evil.com', '/\\evil.com', '/a\nb']) {
    assert.equal(safeInternalPath(bad, '/estimate'), '/estimate');
  }
});
