import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buttonSnippet, embedSnippet, isSnippetKind } from './snippets.ts';

const URL_ = 'https://stayful.co.uk/f/AbCdEfGhIjKlMnOpQrStUvWx';

test('the button is a plain link in their colour, with readable text', () => {
  const b = buttonSnippet(URL_, '#1f5f8b');
  assert.match(b, /^<a href="https:\/\/stayful\.co\.uk\/f\/AbCdEfGhIjKlMnOpQrStUvWx" target="_blank" rel="noopener"/);
  assert.match(b, /background:#1f5f8b;color:#ffffff/);
  assert.match(buttonSnippet(URL_, '#f5d76e'), /color:#111111/);
  // A colour that is not a hex never reaches their page.
  assert.match(buttonSnippet(URL_, 'red;position:fixed'), /background:#2E3D2B/);
});

test('the embed is an iframe of the form', () => {
  const e = embedSnippet(URL_, 'Acme Lettings');
  assert.equal(e, `<iframe src="${URL_}" title="Acme Lettings income report" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`);
});

test('a company name or label cannot break out of the markup', () => {
  const e = embedSnippet(URL_, 'O"Brien <Lets>');
  assert.ok(e.includes('title="O&quot;Brien &lt;Lets&gt; income report"'));
  const b = buttonSnippet(URL_, null, '<b>Go</b>');
  assert.ok(b.includes('&lt;b&gt;Go&lt;/b&gt;</a>'));
});

test('snippet kinds', () => {
  assert.equal(isSnippetKind('embed'), true);
  assert.equal(isSnippetKind('pdf'), false);
});
