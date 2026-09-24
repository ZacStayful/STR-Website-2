import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewMode, parseFunnelPrefill, funnelAnalyseUrl, funnelLabel } from './mode.ts';
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

test('a customer can pass details they already hold into their own link', () => {
  assert.deepEqual(
    parseFunnelPrefill({ name: 'Jo Bloggs', email: 'Jo@Example.com', phone: '07700 900123' }),
    { name: 'Jo Bloggs', email: 'jo@example.com', phone: '07700 900123' },
  );
  assert.deepEqual(parseFunnelPrefill({}), {});
});

test('a prefill value that cannot be trusted is dropped, not carried', () => {
  // Anyone can craft the URL, and whatever survives lands in a form a prospect
  // then submits. A dropped field costs them typing one box.
  assert.deepEqual(parseFunnelPrefill({ email: 'not-an-email' }), {});
  assert.deepEqual(parseFunnelPrefill({ email: '' }), {});
  assert.deepEqual(parseFunnelPrefill({ phone: 'call me maybe' }), {});
  assert.deepEqual(parseFunnelPrefill({ phone: '<script>' }), {});
  assert.deepEqual(parseFunnelPrefill({ name: '   ' }), {});
  // Newlines would let one parameter pose as several lines of a form.
  assert.deepEqual(parseFunnelPrefill({ name: 'Jo\nBloggs' }), { name: 'Jo Bloggs' });
  // Length-capped, so a URL cannot stuff a field.
  assert.equal(parseFunnelPrefill({ name: 'x'.repeat(500) }).name?.length, 120);
});

test('consent is never prefillable', () => {
  // The prospect is giving their details to the customer, who is the data
  // controller. A URL parameter must not be able to assert they agreed.
  const prefill = parseFunnelPrefill({
    name: 'Jo',
    email: 'jo@example.com',
    phone: '07700900123',
  } as Parameters<typeof parseFunnelPrefill>[0]);
  assert.equal('consent' in prefill, false);
  assert.deepEqual(Object.keys(prefill).sort(), ['email', 'name', 'phone']);
});

test('a repeated prefill parameter takes the first value rather than an array', () => {
  assert.deepEqual(parseFunnelPrefill({ name: ['Jo', 'Sam'] }), { name: 'Jo' });
});
