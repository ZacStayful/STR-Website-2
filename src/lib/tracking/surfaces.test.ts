import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCleanForSend, isStripeReturn, surfaceFor, tidiedHref } from './surfaces.ts';

const SITE = 'https://intelligence.stayful.co.uk';

test('white-label, admin, token and unknown pages get nothing at all', () => {
  for (const p of ['/f/abc123', '/r/tok', '/r/tok/pdf', '/admin', '/admin/signups', '/api/consent', '/auth/callback', '/team/join', '/extension/connect', '/presentation', '/demo-report', '/str-report', '/str-report/presentation', '/m', '/profiles/switch', '/no-such-page', '/deals-nope', '', 'relative']) {
    assert.equal(surfaceFor(p), 'none', p);
  }
});

test('marketing and members’ list pages may send a PageView', () => {
  for (const p of ['/', '/pricing', '/features', '/privacy', '/upgrade', '/markets', '/markets/leeds', '/short-let-deals', '/short-let-deals/york', '/today', '/my-deals', '/deals', '/picks', '/account', '/account/billing', '/estimate', '/welcome', '/today/']) {
    assert.equal(surfaceFor(p), 'tracked', p);
  }
});

test('forms with personal details, id and token pages, and share pages show the banner but never send', () => {
  for (const p of ['/login', '/signup', '/signup/check-email', '/forgot-password', '/reset-password', '/account/notifications', '/account/team', '/account/feedback', '/profile', '/profiles', '/leads', '/leads/123', '/leads/funnels/9', '/deals/8f14e45f-ceea-467a-9c3b-1a2b3c4d5e6f', '/reports', '/reports/abc', '/d/sharetoken', '/deal/sharetoken', '/p/picktoken', '/p/d/tok/deal']) {
    assert.equal(surfaceFor(p), 'banner', p);
  }
});

test('an area page takes a town slug only', () => {
  assert.equal(surfaceFor('/markets/leeds'), 'tracked');
  assert.equal(surfaceFor('/markets/new-york'), 'tracked');
  assert.equal(surfaceFor('/markets/Leeds'), 'none');
  assert.equal(surfaceFor('/markets/leeds/extra'), 'none');
});

test('tracking tags come off the address everywhere', () => {
  assert.equal(tidiedHref(`${SITE}/?utm_source=facebook&utm_campaign=test1&utm_content=adA&fbclid=abc`), `${SITE}/`);
  assert.equal(tidiedHref(`${SITE}/pricing?gclid=x&keep=1`), `${SITE}/pricing?keep=1`);
  assert.equal(tidiedHref(`${SITE}/pricing`), null);
});

test('one-shot flags come off only on their own page', () => {
  assert.equal(tidiedHref(`${SITE}/account/billing?topup=1`), `${SITE}/account/billing`);
  assert.equal(tidiedHref(`${SITE}/account/billing?subscribed=1&plan=pro`), `${SITE}/account/billing`);
  assert.equal(tidiedHref(`${SITE}/today?topup=1`), null);
  assert.equal(tidiedHref(`${SITE}/signup?ref=ABCD1234`), `${SITE}/signup`);
});

test('/welcome loses ?next only when it is the default way back', () => {
  assert.equal(tidiedHref(`${SITE}/welcome?next=%2Ftoday`), `${SITE}/welcome`);
  assert.equal(tidiedHref(`${SITE}/welcome?next=%2Fmarkets`), null);
  assert.equal(tidiedHref(`${SITE}/welcome?q=roles&next=%2Fprofile`), null);
});

test('?via is left for the visit heartbeat', () => {
  assert.equal(tidiedHref(`${SITE}/today?via=email`), null);
});

test('nothing is sent from an address with anything after the path', () => {
  assert.equal(isCleanForSend(`${SITE}/today`), true);
  assert.equal(isCleanForSend(`${SITE}/privacy#cookies`), true);
  assert.equal(isCleanForSend(`${SITE}/today?via=email`), false);
  assert.equal(isCleanForSend(`${SITE}/markets?pane=listings&listing=abc&q=12%20High%20St`), false);
  assert.equal(isCleanForSend(`${SITE}/estimate?listing=https%3A%2F%2Fwww.rightmove.co.uk%2Fproperties%2F1`), false);
  assert.equal(isCleanForSend(`${SITE}/signup/check-email?email=a%40b.co`), false);
  assert.equal(isCleanForSend(`${SITE}/?`), false);
  assert.equal(isCleanForSend(`${SITE}/today#access_token=abc.def`), false);
});

test('nothing is sent from a page off the list, even with a clean address', () => {
  assert.equal(isCleanForSend(`${SITE}/deals/8f14e45f-ceea-467a-9c3b-1a2b3c4d5e6f`), false);
  assert.equal(isCleanForSend(`${SITE}/signup`), false);
  assert.equal(isCleanForSend(`${SITE}/f/abc`), false);
  assert.equal(isCleanForSend(`${SITE}/admin`), false);
  assert.equal(isCleanForSend(null), false);
});

test('a Stripe return is recognised before the flags are tidied away', () => {
  assert.equal(isStripeReturn(`${SITE}/account/billing?topup=1`), true);
  assert.equal(isStripeReturn(`${SITE}/account/billing?subscribed=1&plan=pro`), true);
  assert.equal(isStripeReturn(`${SITE}/account/billing`), false);
  assert.equal(isStripeReturn(`${SITE}/today?topup=1`), false);
});
