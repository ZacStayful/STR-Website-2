import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignupReport, DIRECT, pathFor, shareText, weeksToCover, type ActiveWeeks, type SignupFact } from './report.ts';

// Wednesday 1 July 2026, 10:00 UK: week 1 is Mon 29 Jun – Sun 5 Jul.
const CREATED = '2026-07-01T09:00:00Z';
const NOW = new Date('2026-08-03T12:00:00Z');

function fact(over: Partial<SignupFact> & { u: string }): SignupFact {
  return {
    email: `${over.u}@example.com`,
    created: CREATED,
    signed_in: true,
    lead: null,
    a: { src: 'facebook', med: 'paid_social', cmp: 'Spring', cnt: 'Ad 1', fb: true, ref: 'l.facebook.com', env: 'production', method: 'email', team: false },
    profile_done: null,
    first_report: null,
    first_paid: null,
    ...over,
  };
}

const weekly = (active: Record<string, string[]>): ActiveWeeks => ({
  weeks: new Set(['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']),
  active: new Map(Object.entries(active).map(([u, w]) => [u, new Set(w)])),
});

test('rows group by source, campaign and ad, whatever the case', () => {
  const r = buildSignupReport(
    [
      fact({ u: 'a' }),
      fact({ u: 'b', a: { src: 'Facebook', med: null, cmp: 'spring', cnt: 'AD 1', fb: false, ref: null, env: 'production', method: 'google', team: false } }),
      fact({ u: 'c', a: { src: 'facebook', med: null, cmp: 'Autumn', cnt: null, fb: false, ref: null, env: 'production', method: 'email', team: false } }),
    ],
    { now: NOW, weekly: null, excluded: new Set() },
  );
  assert.equal(r.rows.length, 1);
  const fb = r.rows[0];
  assert.equal(fb.label, 'facebook');
  assert.equal(fb.signups, 3);
  assert.deepEqual(fb.children.map((c) => [c.label, c.signups]), [['Spring', 2], ['Autumn', 1]]);
  assert.deepEqual(fb.children[0].children.map((c) => [c.label, c.signups]), [['Ad 1', 2]]);
  assert.equal(fb.children[1].children[0].label, '(no ad)');
});

test('untagged sign-ups sit under direct / unknown by referring site; lead-form ones under their source', () => {
  assert.deepEqual(pathFor(fact({ u: 'a', a: { src: null, med: null, cmp: null, cnt: null, fb: false, ref: 'google.com', env: 'production', method: 'email', team: false } })), [DIRECT, 'google.com']);
  assert.deepEqual(pathFor(fact({ u: 'b', a: { src: null, med: null, cmp: null, cnt: null, fb: false, ref: null, env: 'production', method: 'email', team: false } })), [DIRECT, '(no referring site)']);
  assert.deepEqual(pathFor(fact({ u: 'c', a: null, lead: 'facebook_lead_ad' })), ['facebook_lead_ad (lead form)']);
  assert.deepEqual(pathFor(fact({ u: 'd', a: { src: null, med: null, cmp: null, cnt: null, fb: true, ref: null, env: 'production', method: 'email', team: false } })), ['facebook (click id only)', '(no campaign)', '(no ad)']);
});

test('team invitees, excluded accounts, previews and accounts never signed in are left out and counted', () => {
  const r = buildSignupReport(
    [
      fact({ u: 'a' }),
      fact({ u: 'team', a: { src: 'facebook', med: null, cmp: null, cnt: null, fb: false, ref: null, env: 'production', method: 'email', team: true } }),
      fact({ u: 'staff' }),
      fact({ u: 'preview', a: { src: 'facebook', med: null, cmp: null, cnt: null, fb: false, ref: null, env: 'preview', method: 'email', team: false } }),
      fact({ u: 'ghost', signed_in: false }),
    ],
    { now: NOW, weekly: null, excluded: new Set(['staff']) },
  );
  assert.equal(r.total.signups, 1);
  assert.deepEqual(r.left, { teamInvites: 1, excluded: 1, neverSignedIn: 1, notProduction: 1 });
});

test('first report within 7 days only counts members whose 7 days are over', () => {
  const r = buildSignupReport(
    [
      fact({ u: 'quick', first_report: '2026-07-03T09:00:00Z' }),
      fact({ u: 'slow', first_report: '2026-07-20T09:00:00Z' }),
      fact({ u: 'never' }),
      fact({ u: 'new', created: '2026-08-01T09:00:00Z', first_report: '2026-08-01T10:00:00Z' }),
    ],
    { now: NOW, weekly: null, excluded: new Set() },
  );
  assert.deepEqual(r.total.firstReport, { n: 1, base: 3 });
});

test('profile and paid count over every sign-up', () => {
  const r = buildSignupReport([fact({ u: 'a', profile_done: CREATED, first_paid: CREATED }), fact({ u: 'b', profile_done: CREATED }), fact({ u: 'c' })], { now: NOW, weekly: null, excluded: new Set() });
  assert.deepEqual(r.total.profile, { n: 2, base: 3 });
  assert.deepEqual(r.total.paid, { n: 1, base: 3 });
});

test('weeks 2 to 4 after sign-up use the weekly-active figures, and only count once each week is over', () => {
  // Week 2 starts 6 Jul, week 3 13 Jul, week 4 20 Jul: all over by 3 Aug.
  const r = buildSignupReport([fact({ u: 'a' }), fact({ u: 'b' }), fact({ u: 'late', created: '2026-07-22T09:00:00Z' })], {
    now: NOW,
    weekly: weekly({ a: ['2026-07-06', '2026-07-20'], b: ['2026-07-13'], late: ['2026-07-27'] }),
    excluded: new Set(),
  });
  // 'late' joined in the week of 20 Jul: its week 2 (27 Jul) is over, week 3 (3 Aug) is not.
  assert.deepEqual(r.total.weeks, [
    { n: 2, base: 3 },
    { n: 1, base: 2 },
    { n: 1, base: 2 },
  ]);
  // No weekly figures: the week columns show nothing rather than zero.
  const none = buildSignupReport([fact({ u: 'a' })], { now: NOW, weekly: null, excluded: new Set() });
  assert.deepEqual(none.total.weeks, [{ n: 0, base: 0 }, { n: 0, base: 0 }, { n: 0, base: 0 }]);
});

test('rows under 20 sign-ups are greyed; counts sit beside the %', () => {
  const many = Array.from({ length: 20 }, (_, i) => fact({ u: `m${i}` }));
  const r = buildSignupReport([...many, fact({ u: 'x', a: { src: 'newsletter', med: null, cmp: null, cnt: null, fb: false, ref: null, env: 'production', method: 'email', team: false } })], { now: NOW, weekly: null, excluded: new Set() });
  assert.equal(r.rows.find((x) => x.label === 'facebook')?.grey, false);
  assert.equal(r.rows.find((x) => x.label === 'newsletter')?.grey, true);
  assert.equal(shareText({ n: 3, base: 12 }), '3 / 12 (25%)');
  assert.equal(shareText({ n: 0, base: 0 }), '—');
});

test('the weekly figures cover the range plus the four weeks after, capped', () => {
  assert.equal(weeksToCover(new Date('2026-07-01T09:00:00Z'), NOW), 6);
  assert.equal(weeksToCover(new Date('2026-07-30T09:00:00Z'), NOW), 5);
  assert.equal(weeksToCover(null, NOW), 56);
  assert.equal(weeksToCover(new Date('2020-01-01T00:00:00Z'), NOW), 56);
});
