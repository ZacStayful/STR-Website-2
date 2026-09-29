import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributionRow, chooseTouch, cleanLandingPath, isTagged, keepFirst, parseTouch, referrerDomain, serializeTouch, touchForCookie, touchFromPage, type Touch } from './touch.ts';

const NOW = Date.UTC(2026, 9, 1, 10, 0, 0);
const DAYS = 30;

test('the tags and the click id are read from the landing address', () => {
  const t = touchFromPage('https://app.stayful.co.uk/?utm_source=facebook&utm_medium=paid_social&utm_campaign=Spring%20R2R&utm_content=Ad%203&utm_term=Set%201&fbclid=IwAR0abc_DEF-1', 'https://l.facebook.com/', NOW);
  assert.deepEqual(t, {
    src: 'facebook',
    med: 'paid_social',
    cmp: 'Spring R2R',
    cnt: 'Ad 3',
    trm: 'Set 1',
    fbclid: 'IwAR0abc_DEF-1',
    fbAt: NOW,
    lp: '/',
    ref: 'l.facebook.com',
    at: NOW,
  });
});

test('an ad that pointed at a members’ page is read from inside ?redirect=', () => {
  const t = touchFromPage('https://app.stayful.co.uk/login?redirect=%2Fdeals%3Futm_source%3Dfacebook%26utm_campaign%3DDeals%26fbclid%3Dabc', null, NOW);
  assert.equal(t?.src, 'facebook');
  assert.equal(t?.cmp, 'Deals');
  assert.equal(t?.fbclid, 'abc');
  assert.equal(t?.lp, '/deals');
  const n = touchFromPage('https://app.stayful.co.uk/signup?next=%2Ftoday%3Futm_source%3Dnewsletter', null, NOW);
  assert.equal(n?.src, 'newsletter');
  // Never from another site's address.
  assert.equal(touchFromPage('https://app.stayful.co.uk/login?redirect=%2F%2Fevil.com%3Futm_source%3Dx', null, NOW)?.src, null);
});

test('nothing is captured on white-label, admin or token pages', () => {
  for (const path of ['/f/abc?utm_source=facebook', '/r/tok?utm_source=facebook', '/admin?utm_source=facebook', '/nowhere?utm_source=x']) {
    assert.equal(touchFromPage(`https://app.stayful.co.uk${path}`, null, NOW), null, path);
  }
});

test('an untagged visit keeps its landing path and referring site only', () => {
  const t = touchFromPage('https://app.stayful.co.uk/pricing?plan=pro', 'https://www.google.com/search?q=secret', NOW);
  assert.equal(isTagged(t), false);
  assert.equal(t?.lp, '/pricing');
  assert.equal(t?.ref, 'google.com');
  assert.equal(touchFromPage('https://app.stayful.co.uk/pricing', 'https://app.stayful.co.uk/features?x=1', NOW)?.ref, null);
});

test('landing paths lose their query, ids and tokens', () => {
  assert.equal(cleanLandingPath('/short-let-deals/manchester?utm_source=x'), '/short-let-deals/manchester');
  assert.equal(cleanLandingPath('/deals/3f2b8c1e-8d6a-4c55-9a51-0c6b1f0e2a11'), '/deals/:id');
  assert.equal(cleanLandingPath('/d/shorttoken'), '/d/:id');
  assert.equal(cleanLandingPath('/team/join/abc'), '/team/join/:id');
  assert.equal(cleanLandingPath('/estimate/12345'), '/estimate/:id');
  assert.equal(cleanLandingPath('/x/jo%40example.com'), '/x/:id');
  assert.equal(cleanLandingPath('//evil.com'), null);
  assert.equal(cleanLandingPath('relative'), null);
});

test('referring domains: host only, never our own site', () => {
  assert.equal(referrerDomain('https://m.facebook.com/some/path?x=1', 'app.stayful.co.uk'), 'm.facebook.com');
  assert.equal(referrerDomain('https://app.stayful.co.uk/x', 'app.stayful.co.uk'), null);
  assert.equal(referrerDomain('android-app://com.google.android.gm/', 'app.stayful.co.uk'), null);
  assert.equal(referrerDomain('', 'app.stayful.co.uk'), null);
});

const tagged: Touch = { src: 'facebook', med: null, cmp: 'A', cnt: null, trm: null, fbclid: null, fbAt: null, lp: '/', ref: null, at: NOW - 86_400_000 };
const untagged: Touch = { src: null, med: null, cmp: null, cnt: null, trm: null, fbclid: null, fbAt: null, lp: '/pricing', ref: 'google.com', at: NOW - 1000 };
const later: Touch = { ...tagged, src: 'newsletter', at: NOW };

test('first touch wins in page memory; untagged gives way to tagged', () => {
  assert.equal(keepFirst(null, untagged), untagged);
  assert.equal(keepFirst(untagged, later), later);
  assert.equal(keepFirst(tagged, later), tagged);
  assert.equal(keepFirst(tagged, untagged), tagged);
});

test('the cookie keeps the first tagged touch for 30 days', () => {
  assert.equal(touchForCookie(null, later, NOW, DAYS), later);
  assert.equal(touchForCookie(tagged, later, NOW, DAYS), null);
  assert.equal(touchForCookie(untagged, later, NOW, DAYS), later);
  assert.equal(touchForCookie(null, untagged, NOW, DAYS), null, 'untagged visits are never kept in the cookie');
  const old = { ...tagged, at: NOW - 31 * 86_400_000 };
  assert.equal(touchForCookie(old, later, NOW, DAYS), later);
});

test('a touch survives every carrier, and anything tampered is dropped or capped', () => {
  const t = touchFromPage('https://app.stayful.co.uk/?utm_source=facebook&fbclid=abc', 'https://l.facebook.com/', NOW)!;
  assert.deepEqual(parseTouch(serializeTouch(t), NOW), t);
  assert.equal(parseTouch('not base64!', NOW), null);
  assert.equal(parseTouch(serializeTouch({ ...t, at: NOW + 3_600_000 }), NOW), null, 'from the future');
  const long = parseTouch(serializeTouch({ ...t, cmp: 'x'.repeat(500), ref: 'bad domain/path', lp: '/deals/3f2b8c1e-8d6a-4c55-9a51-0c6b1f0e2a11?q=1' }), NOW);
  assert.equal(long?.cmp?.length, 200);
  assert.equal(long?.ref, null);
  assert.equal(long?.lp, '/deals/:id');
  assert.equal(parseTouch(serializeTouch({ ...t, fbclid: 'has spaces' }), NOW)?.fbclid, null);
});

test('the cookie beats what the page carried to sign-up', () => {
  assert.deepEqual(chooseTouch(tagged, later, 'form'), { touch: tagged, via: 'cookie' });
  assert.deepEqual(chooseTouch(null, later, 'redirect'), { touch: later, via: 'redirect' });
  assert.deepEqual(chooseTouch(null, null, 'form'), { touch: null, via: 'none' });
});

test('the attribution row', () => {
  const withClick = { ...tagged, fbclid: 'abc', fbAt: NOW };
  assert.deepEqual(attributionRow({ userId: 'u1', env: 'production', method: 'google', teamInvite: false, touch: withClick, via: 'cookie' }), {
    user_id: 'u1',
    env: 'production',
    signup_method: 'google',
    team_invite: false,
    utm_source: 'facebook',
    utm_medium: null,
    utm_campaign: 'A',
    utm_content: null,
    utm_term: null,
    fbclid: 'abc',
    fbclid_at: new Date(NOW).toISOString(),
    landing_path: '/',
    referrer_domain: null,
    captured_via: 'cookie',
  });
  assert.equal(attributionRow({ userId: 'u1', env: 'production', method: 'email', teamInvite: true, touch: null, via: 'form' }).captured_via, 'none');
});
