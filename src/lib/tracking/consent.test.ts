import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerShown, consentFromCookieString, deviceChoiceAdoptable, memberChoiceCurrent, parseConsent, quizCheckboxShown, secondChanceShown, serializeConsent } from './consent.ts';

const VID = '8f14e45f-ceea-467a-9c3b-1a2b3c4d5e6f';

test('the consent cookie round-trips', () => {
  const c = { choice: 'accept' as const, at: new Date('2026-10-01T10:00:00Z'), visitorId: VID, version: 'cookie-v1' };
  const v = serializeConsent(c);
  assert.equal(v, `a.1790848800.${VID}.cookie-v1`);
  assert.deepEqual(parseConsent(v), c);
  assert.equal(parseConsent(serializeConsent({ ...c, choice: 'reject' }))?.choice, 'reject');
});

test('anything that is not our cookie reads as no choice', () => {
  for (const bad of ['', 'yes', 'a.1.2.3', `x.1791021600.${VID}.cookie-v1`, `a.179102160099.${VID}.cookie-v1`, 'a.1791021600.not-a-uuid.cookie-v1', `a.1791021600.${VID}.COOKIE V1`]) {
    assert.equal(parseConsent(bad), null, bad);
  }
  assert.equal(parseConsent(null), null);
});

test('found inside a Cookie header or document.cookie', () => {
  assert.equal(consentFromCookieString(`sb-x-auth-token=abc; sf_consent=r.1791021600.${VID}.cookie-v1; _fbp=fb.1.1.2`)?.choice, 'reject');
  assert.equal(consentFromCookieString('sf_consent_other=1'), null);
  assert.equal(consentFromCookieString(''), null);
});

test('a device\'s choice becomes the member\'s only if made signed out or by them, and newer', () => {
  const at = new Date('2026-10-02T10:00:00Z');
  assert.equal(deviceChoiceAdoptable({ userId: null, at }, 'u1', null), true, 'the landing page before signing up');
  assert.equal(deviceChoiceAdoptable({ userId: 'u1', at }, 'u1', { choice: 'reject', chosenAt: new Date('2026-10-01T10:00:00Z') }), true);
  assert.equal(deviceChoiceAdoptable({ userId: 'u2', at }, 'u1', null), false, 'someone else\'s choice on a shared device');
  assert.equal(deviceChoiceAdoptable(null, 'u1', null), false, 'a cookie with no record behind it');
  assert.equal(deviceChoiceAdoptable({ userId: null, at }, 'u1', { choice: 'reject', chosenAt: at }), false, 'the same moment is not newer');
  assert.equal(deviceChoiceAdoptable({ userId: null, at }, 'u1', { choice: 'reject', chosenAt: new Date('2026-10-03T10:00:00Z') }), false);
});

test('a member\'s saved choice lasts 6 months', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  assert.equal(memberChoiceCurrent(new Date('2026-12-01T00:00:00Z'), now), true);
  assert.equal(memberChoiceCurrent(new Date('2026-07-10T00:00:00Z'), now), true);
  assert.equal(memberChoiceCurrent(new Date('2026-06-01T00:00:00Z'), now), false);
});

test('the second-chance checkbox shows until someone says yes', () => {
  assert.equal(secondChanceShown(null), true);
  assert.equal(secondChanceShown('reject'), true);
  assert.equal(secondChanceShown('accept'), false);
});

test('the banner', () => {
  const base = { enabled: true, surface: 'tracked' as const, choice: null, dismissed: false, settingsOpen: false, lookingUp: false };
  assert.equal(bannerShown(base), true);
  assert.equal(bannerShown({ ...base, choice: 'reject' }), false);
  assert.equal(bannerShown({ ...base, dismissed: true }), false);
  assert.equal(bannerShown({ ...base, lookingUp: true }), false);
  assert.equal(bannerShown({ ...base, surface: 'none' }), false);
  assert.equal(bannerShown({ ...base, enabled: false }), false);
  assert.equal(bannerShown({ ...base, choice: 'accept', settingsOpen: true }), true);
  assert.equal(bannerShown({ ...base, surface: 'none', settingsOpen: true }), false);
  assert.equal(bannerShown({ ...base, surface: 'banner' }), true);
});

test('the quiz start screen asks a new Google sign-up once, while nobody has said yes', () => {
  const base = { enabled: true, fresh: true, google: true, teamSeat: false, memberChoice: null, deviceChoice: null } as const;
  assert.equal(quizCheckboxShown(base), true);
  assert.equal(quizCheckboxShown({ ...base, deviceChoice: 'reject' }), true);
  assert.equal(quizCheckboxShown({ ...base, memberChoice: 'accept' }), false);
  assert.equal(quizCheckboxShown({ ...base, deviceChoice: 'accept' }), false);
  assert.equal(quizCheckboxShown({ ...base, google: false }), false, 'email sign-ups had the form checkbox');
  assert.equal(quizCheckboxShown({ ...base, teamSeat: true }), false);
  assert.equal(quizCheckboxShown({ ...base, fresh: false }), false);
  assert.equal(quizCheckboxShown({ ...base, enabled: false }), false);
});
