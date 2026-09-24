import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewMode, funnelAnalyseUrl, funnelLabel } from './mode.ts';
import { EMPTY_BRAND } from './brand.ts';

test('?preview=1 is the form and ?preview=report is the report', () => {
  // The settings page used to promise ?preview=1 showed "a sample report".
  // It shows the form. This is that copy bug in executable form.
  assert.equal(previewMode('1'), 'form');
  assert.equal(previewMode('report'), 'report');
});

test('anything unrecognised is not a preview at all', () => {
  // Load-bearing: a preview renders a PAUSED funnel for its owner, so a value
  // this function does not recognise must never be read as asking for one.
  for (const raw of [undefined, '', '0', 'true', 'yes', 'REPORT', 'Report', 'form', '2', '1 ']) {
    assert.equal(previewMode(raw), 'none', `expected none for ${JSON.stringify(raw)}`);
  }
});

test('a repeated query parameter arrives as an array and still resolves', () => {
  // ?preview=1&preview=report reaches a page as ['1', 'report'].
  assert.equal(previewMode(['report', '1']), 'report');
  assert.equal(previewMode(['1']), 'form');
  assert.equal(previewMode([]), 'none');
  assert.equal(previewMode(['nonsense', 'report']), 'none');
});

test('a funnel addresses its own analyse route, with the token escaped', () => {
  assert.equal(funnelAnalyseUrl('abc-123_XYZ'), '/api/f/abc-123_XYZ/analyse');
  assert.equal(funnelAnalyseUrl('a/b?c'), '/api/f/a%2Fb%3Fc/analyse');
});

test('an unbranded funnel is labelled neutrally rather than as Stayful', () => {
  assert.equal(funnelLabel({ token: 't', brand: EMPTY_BRAND, reportDepth: 'standard' }), 'Property income analysis');
  assert.equal(
    funnelLabel({ token: 't', brand: { ...EMPTY_BRAND, companyName: 'Harrison' }, reportDepth: 'standard' }),
    'Harrison',
  );
});
