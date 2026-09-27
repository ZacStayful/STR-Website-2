import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EXTRAS_BYTES, buildActivityCall, cleanExtras, dealIdOfItemKey, visitModeFor } from './event.ts';

const USER = '00000000-0000-4000-8000-00000000000a';
const DEAL = 'd0000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-28T10:00:00.000Z');
const prod = { now: NOW, env: 'production', background: false };

test('a usable call carries the member, kind, time and whether it counts', () => {
  const call = buildActivityCall(USER, 'keep', { dealId: DEAL }, prod);
  assert.deepEqual(call, { user: USER, kind: 'keep', at: NOW.toISOString(), extras: {}, visit: 'extend', counted: true, deal: DEAL });
});

test('no member, a bad id or an unknown kind logs nothing', () => {
  assert.equal(buildActivityCall(null, 'keep', {}, prod), null);
  assert.equal(buildActivityCall(undefined, 'keep', {}, prod), null);
  assert.equal(buildActivityCall('not-a-uuid', 'keep', {}, prod), null);
  assert.equal(buildActivityCall(USER, 'made_up', {}, prod), null);
});

test('extras keep tokens, numbers, booleans, null and short lists', () => {
  assert.deepEqual(cleanExtras({ from: 'watching', to: 'contacted', amount_pence: 2000, on: false, reasons: ['too_far', 'price'], plan: null }), {
    from: 'watching',
    to: 'contacted',
    amount_pence: 2000,
    on: false,
    reasons: ['too_far', 'price'],
    plan: null,
  });
});

test('extras never hold an address, a postcode, a link or an email', () => {
  const out = cleanExtras({
    address: '12 High Street, Leeds',
    postcode: 'LS6 1AA',
    tight: 'LS61AA',
    outcode: 'LS6',
    link: 'https://www.rightmove.co.uk/properties/1',
    bare: 'www.zoopla.co.uk',
    domain: 'rightmove.co.uk',
    email: 'someone@example.com',
    sentence: 'too far away',
    list: ['ok_token', 'SW1A 1AA', 'www.example.com', 'fine'],
    kept: 'kept-r2r-company-let',
  });
  assert.deepEqual(out, { list: ['ok_token', 'fine'], kept: 'kept-r2r-company-let' });
});

test('an id inside a token is not mistaken for a postcode', () => {
  assert.deepEqual(cleanExtras({ item: 'l-c0e4a2bc-0000-4000-8000-00000000abcd' }), { item: 'l-c0e4a2bc-0000-4000-8000-00000000abcd' });
});

test('bad keys, objects, NaN and long values are dropped, never the event', () => {
  const out = cleanExtras({ 'Bad Key': 'x', nested: { a: 1 } as never, nan: Number.NaN, long: 'x'.repeat(81), ok: 1 });
  assert.deepEqual(out, { ok: 1 });
  assert.deepEqual(cleanExtras(null), {});
  assert.deepEqual(cleanExtras(['a'] as never), {});
});

test('extras stay under the size limit and twelve keys', () => {
  const big: Record<string, string[]> = {};
  for (let i = 0; i < 20; i += 1) big[`k${i}`] = Array.from({ length: 20 }, () => 'y'.repeat(60));
  const out = cleanExtras(big);
  assert.ok(Object.keys(out).length <= 12);
  assert.ok(JSON.stringify(out).length <= MAX_EXTRAS_BYTES);
});

test('a listing URL is passed for the deal lookup only when there is no deal id', () => {
  assert.equal(buildActivityCall(USER, 'report_run', { listingUrl: 'https://www.rightmove.co.uk/properties/1' }, prod)?.listing_url, 'https://www.rightmove.co.uk/properties/1');
  assert.equal(buildActivityCall(USER, 'report_run', { dealId: DEAL, listingUrl: 'https://www.rightmove.co.uk/properties/1' }, prod)?.listing_url, undefined);
  assert.equal(buildActivityCall(USER, 'report_run', { listingUrl: 'javascript:alert(1)' }, prod)?.listing_url, undefined);
  // And it is never copied into extras.
  assert.deepEqual(buildActivityCall(USER, 'report_run', { listingUrl: 'https://www.rightmove.co.uk/properties/1' }, prod)?.extras, {});
});

test('dedupe keys, sources, times and profile ids are checked', () => {
  const call = buildActivityCall(USER, 'topup', { dedupeKey: 'topup:pi:abc_123', source: 'web', at: '2026-09-01T09:00:00Z', profileId: DEAL }, prod);
  assert.equal(call?.dedupe_key, 'topup:pi:abc_123');
  assert.equal(call?.source, 'web');
  assert.equal(call?.at, '2026-09-01T09:00:00.000Z');
  assert.equal(call?.profile, DEAL);
  const bad = buildActivityCall(USER, 'topup', { dedupeKey: 'has space', source: 'carrier-pigeon' as never, at: 'soon', profileId: 'x' }, prod);
  assert.equal(bad?.dedupe_key, undefined);
  assert.equal(bad?.source, undefined);
  assert.equal(bad?.at, NOW.toISOString());
  assert.equal(bad?.profile, undefined);
});

test('events outside production say where they came from', () => {
  assert.deepEqual(buildActivityCall(USER, 'keep', {}, { ...prod, env: 'preview' })?.extras, { env: 'preview' });
  assert.deepEqual(buildActivityCall(USER, 'keep', {}, prod)?.extras, {});
});

test('how an event joins a visit', () => {
  assert.equal(visitModeFor('keep', undefined, false), 'extend');
  assert.equal(visitModeFor('keep', 'web', false), 'extend');
  assert.equal(visitModeFor('keep', undefined, true), 'attach');
  assert.equal(visitModeFor('email_feedback', 'email_link', false), 'attach');
  assert.equal(visitModeFor('email_click', undefined, false), 'attach');
  assert.equal(visitModeFor('auto_topup', 'system', true), 'none');
});

test('a My deals key gives the deal id only for a marketplace deal', () => {
  assert.equal(dealIdOfItemKey(`d-${DEAL}`), DEAL);
  assert.equal(dealIdOfItemKey(`l-${DEAL}`), null);
  assert.equal(dealIdOfItemKey('d-nope'), null);
  assert.equal(dealIdOfItemKey(undefined), null);
});
