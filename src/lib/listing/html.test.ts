import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBalancedJson, jsonAfter, scriptJsonById, jsonLdBlocks, metaContent, titleOf, decodeEntities, findNode, parsePrice, findPostcode, findOutcode } from './html.ts';

test('extractBalancedJson respects strings containing braces', () => {
  const text = 'x = {"a":"}","b":[1,{"c":"]"}]}; y = 1';
  assert.equal(extractBalancedJson(text, 4), '{"a":"}","b":[1,{"c":"]"}]}');
});

test('jsonAfter parses an assignment and ignores trailing code', () => {
  const v = jsonAfter('window.PAGE_MODEL = {"data":"[1]"};window.adInfo=[1,2]', 'PAGE_MODEL');
  assert.deepEqual(v, { data: '[1]' });
  assert.equal(jsonAfter('nothing here', 'PAGE_MODEL'), null);
});

test('scriptJsonById and jsonLdBlocks', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"a":1}}</script><script type="application/ld+json">{"@type":"Hotel"}</script><script type="application/ld+json">not json</script>';
  assert.deepEqual(scriptJsonById(html, '__NEXT_DATA__'), { props: { a: 1 } });
  assert.deepEqual(jsonLdBlocks(html), [{ '@type': 'Hotel' }]);
});

test('meta, title and entities', () => {
  const html = '<head><title> Two &amp; a half </title><meta property="og:title" content="Home &middot; &#163;1,000" /><meta content="x" name="description"></head>';
  assert.equal(titleOf(html), 'Two & a half');
  assert.equal(metaContent(html, 'og:title'), 'Home · £1,000');
  assert.equal(metaContent(html, 'description'), 'x');
  assert.equal(metaContent(html, 'missing'), null);
  assert.equal(decodeEntities('&pound;5 &gt; &#x41;'), '£5 > A');
});

test('findNode finds the first matching object depth-first', () => {
  const root = { a: [{ b: 1 }, { listingLat: 1, listingLng: 2 }], c: { listingLat: 9 } };
  assert.deepEqual(findNode(root, (o) => 'listingLat' in o), { listingLat: 1, listingLng: 2 });
  assert.equal(findNode(root, (o) => 'nope' in o), null);
});

test('parsePrice handles sale, pcm, pw and nightly', () => {
  assert.deepEqual(parsePrice('£220,000'), { amount: 220000, period: 'total' });
  assert.deepEqual(parsePrice('£1,195 pcm'), { amount: 1195, period: 'pcm' });
  assert.deepEqual(parsePrice('£276 pw'), { amount: 276, period: 'pw' });
  assert.deepEqual(parsePrice('£ 89 per night'), { amount: 89, period: 'night' });
  assert.equal(parsePrice('POA'), null);
  assert.equal(parsePrice(null), null);
});

test('postcode helpers', () => {
  assert.deepEqual(findPostcode('Hudson Building, Manchester, m4 5ae'), { postcode: 'M4 5AE', outcode: 'M4' });
  assert.equal(findPostcode('Labrador Quay, Salford, M50'), null);
  assert.equal(findOutcode('Labrador Quay, Salford, Lancashire, M50'), 'M50');
  assert.equal(findOutcode('Hudson Building, M4 5AE'), 'M4');
  assert.equal(findOutcode('Somewhere nice'), null);
});
