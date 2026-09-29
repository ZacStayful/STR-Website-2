import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFbc, cleanFbclid, cookieDomainsFor, fbclidOf, isValidFbc, isValidFbp, registrableDomain } from './fbc.ts';

test('fbc is fb.1.<ms>.<fbclid>', () => {
  assert.equal(buildFbc('abc', 1_700_000_000_000), 'fb.1.1700000000000.abc');
  assert.equal(buildFbc('IwAR3x_y-Z', 1_700_000_000_123.9), 'fb.1.1700000000123.IwAR3x_y-Z');
});

test('an fbclid with anything but letters, digits, - and _ is refused', () => {
  assert.equal(cleanFbclid('abc def'), null);
  assert.equal(cleanFbclid('abc<script>'), null);
  assert.equal(cleanFbclid(''), null);
  assert.equal(buildFbc('a b', 1_700_000_000_000), null);
  assert.equal(buildFbc('abc', 0), null);
});

test('fbc and fbp formats', () => {
  assert.ok(isValidFbc('fb.1.1554763741205.AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'));
  assert.ok(isValidFbc('fb.2.1554763741205.IwZXh0bgNhZW0_aem_x.AQ'));
  assert.ok(!isValidFbc('fb.1.123.abc'));
  assert.ok(!isValidFbc('hello'));
  assert.ok(isValidFbp('fb.1.1596403881668.1116446470'));
  assert.ok(!isValidFbp('fb.1.1596403881668.abc'));
  assert.equal(fbclidOf('fb.1.1554763741205.abc'), 'abc');
});

test('cookies are cleared on the host and every parent domain', () => {
  assert.deepEqual(cookieDomainsFor('intelligence.stayful.co.uk'), ['intelligence.stayful.co.uk', 'stayful.co.uk', 'co.uk']);
  assert.deepEqual(cookieDomainsFor('localhost'), []);
  assert.deepEqual(cookieDomainsFor('127.0.0.1'), []);
});

test('our _fbc goes on the registrable domain, like the pixel', () => {
  assert.equal(registrableDomain('intelligence.stayful.co.uk'), 'stayful.co.uk');
  assert.equal(registrableDomain('stayful.co.uk'), 'stayful.co.uk');
  assert.equal(registrableDomain('app.example.com'), 'example.com');
  assert.equal(registrableDomain('my-app-git-x.vercel.app'), 'my-app-git-x.vercel.app');
  assert.equal(registrableDomain('localhost'), null);
});
