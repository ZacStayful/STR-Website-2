import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeInternalPath } from './safe-path.ts';

test('accepts same-origin absolute paths', () => {
  assert.equal(safeInternalPath('/markets', '/estimate'), '/markets');
  assert.equal(safeInternalPath('/markets/manchester?x=1', '/estimate'), '/markets/manchester?x=1');
  assert.equal(safeInternalPath('/profiles?next=%2Ftoday#top', '/estimate'), '/profiles?next=%2Ftoday#top');
});

test('falls back for anything else', () => {
  for (const bad of [null, undefined, '', 'markets', 'https://evil.com', '//evil.com', '/\\evil.com', '/a\nb']) {
    assert.equal(safeInternalPath(bad, '/estimate'), '/estimate');
  }
});

test('a tab, newline or backslash anywhere cannot turn into another site', () => {
  for (const bad of ['/\t/evil.com', '/\t\\evil.com', '/\r/evil.com', '/\n/evil.com', '/\u0000/evil.com', '/a/\\evil.com', '/.\\/evil.com', '/\u007f/x', '/..//evil.com', '/./x', '/a/../b', '/a/.']) {
    assert.equal(safeInternalPath(bad, '/estimate'), '/estimate', JSON.stringify(bad));
  }
});

test('dots are fine inside a name or the query, not as a path segment', () => {
  assert.equal(safeInternalPath('/deals/abc.def', '/estimate'), '/deals/abc.def');
  assert.equal(safeInternalPath('/markets?next=../x', '/estimate'), '/markets?next=../x');
  assert.equal(safeInternalPath('/a/..b', '/estimate'), '/a/..b');
});

test('whatever it returns resolves on our own site', () => {
  const origin = 'https://intelligence.stayful.co.uk';
  for (const raw of ['/today', '/\t/evil.com', '/%09/evil.com', '/%2F%2Fevil.com', '/ /evil.com', '/..//evil.com', '/./\t/evil.com']) {
    const path = safeInternalPath(raw, '/today');
    assert.equal(new URL(path, origin).origin, origin, `${JSON.stringify(raw)} → ${path}`);
  }
});
