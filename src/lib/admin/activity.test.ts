import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateActivity, activityScore, defaultDir, isHighIntent, isSortKey, latestOf, sortMembers, type MemberActivity } from './activity.ts';

const profile = (id: string, over: Partial<{ email: string | null; full_name: string | null; mobile: string | null; plan_code: string | null; last_seen_at: string | null }> = {}) => ({
  id,
  email: `${id}@x.test`,
  full_name: null,
  mobile: null,
  plan_code: null,
  last_seen_at: null,
  ...over,
});

test('aggregateActivity counts each source per member and sums debits as positive pence', () => {
  const rows = aggregateActivity({
    profiles: [profile('a', { full_name: ' Ann ', mobile: '07700 900000', plan_code: 'pro', last_seen_at: '2026-09-01T00:00:00Z' }), profile('b')],
    opens: [{ user_id: 'a', opened_at: '2026-09-10T00:00:00Z' }, { user_id: 'a', opened_at: '2026-09-12T00:00:00Z' }],
    reports: [{ user_id: 'a', created_at: '2026-09-20T00:00:00Z' }, { user_id: 'zzz', created_at: '2026-09-20T00:00:00Z' }],
    picks: [{ user_id: 'a', sent_at: '2026-09-24T07:00:00Z' }, { user_id: 'b', sent_at: '2026-09-24T07:00:00Z' }],
    debits: [{ user_id: 'a', amount_pence: -485, at: '2026-09-20T00:00:00Z' }, { user_id: 'a', amount_pence: '-10', at: '2026-09-24T07:00:00Z' }],
  });
  assert.equal(rows.length, 2, 'one row per profile, unknown ids ignored');
  const a = rows.find((r) => r.id === 'a')!;
  assert.equal(a.name, 'Ann');
  assert.equal(a.planCode, 'pro');
  assert.equal(a.dealOpens, 2);
  assert.equal(a.reports, 1);
  assert.equal(a.picks, 1);
  assert.equal(a.creditSpentPence, 495);
  // Last active is the latest thing the member DID; a pick received does not count.
  assert.equal(a.lastActiveAt, '2026-09-24T07:00:00Z');
  const b = rows.find((r) => r.id === 'b')!;
  assert.deepEqual([b.dealOpens, b.reports, b.picks, b.creditSpentPence, b.lastActiveAt, b.planCode, b.name], [0, 0, 1, 0, null, null, null]);
});

test('latestOf ignores blanks and junk', () => {
  assert.equal(latestOf(null, undefined, 'junk'), null);
  assert.equal(latestOf('2026-01-01T00:00:00Z', null, '2026-03-01T00:00:00Z', 'junk'), '2026-03-01T00:00:00Z');
});

const row = (id: string, over: Partial<MemberActivity> = {}): MemberActivity => ({ id, name: null, email: `${id}@x.test`, mobile: null, planCode: null, dealOpens: 0, reports: 0, picks: 0, creditSpentPence: 0, atOffer: 0, atSecured: 0, lastActiveAt: null, ...over });

test('high intent is 10+ deal opens OR 5+ reports in the window', () => {
  assert.equal(isHighIntent(row('a', { dealOpens: 10 })), true);
  assert.equal(isHighIntent(row('a', { reports: 5 })), true);
  assert.equal(isHighIntent(row('a', { dealOpens: 9, reports: 4, picks: 100 })), false);
});

test('the default sort is activity, most active first, with picks weighing less than opens and reports', () => {
  const quiet = row('quiet', { picks: 20 });
  const opener = row('opener', { dealOpens: 4 });
  const reporter = row('reporter', { reports: 5, picks: 1 });
  assert.ok(activityScore(reporter) > activityScore(opener) && activityScore(opener) < activityScore(quiet));
  assert.deepEqual(sortMembers([quiet, opener, reporter], 'activity', 'desc').map((r) => r.id), ['quiet', 'reporter', 'opener']);
});

test('every column sorts both ways; blanks go last for text columns; ties fall back to activity', () => {
  const rows = [
    row('a', { name: 'Zed', email: 'z@x.test', mobile: null, planCode: 'starter', dealOpens: 1, reports: 0, creditSpentPence: 100, lastActiveAt: '2026-09-01T00:00:00Z' }),
    row('b', { name: null, email: 'b@x.test', mobile: '07700', planCode: null, dealOpens: 5, reports: 2, creditSpentPence: 900, lastActiveAt: '2026-09-20T00:00:00Z' }),
    row('c', { name: 'Amy', email: 'c@x.test', mobile: '07711', planCode: 'pro', dealOpens: 5, reports: 0, creditSpentPence: 300, lastActiveAt: null }),
  ];
  assert.deepEqual(sortMembers(rows, 'name', 'asc').map((r) => r.id), ['c', 'a', 'b'], 'blank name last');
  assert.deepEqual(sortMembers(rows, 'name', 'desc').map((r) => r.id), ['a', 'c', 'b'], 'blank name still last');
  assert.deepEqual(sortMembers(rows, 'plan', 'asc').map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(sortMembers(rows, 'opens', 'desc').map((r) => r.id), ['b', 'c', 'a'], 'tie on opens broken by activity');
  assert.deepEqual(sortMembers(rows, 'opens', 'asc').map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(sortMembers(rows, 'spent', 'desc').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortMembers(rows, 'lastActive', 'desc').map((r) => r.id), ['b', 'a', 'c'], 'never active last');
  assert.deepEqual(sortMembers(rows, 'lastActive', 'asc').map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(sortMembers(rows, 'email', 'asc').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortMembers(rows, 'mobile', 'desc').map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(sortMembers(rows, 'reports', 'desc').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortMembers(rows, 'picks', 'desc').map((r) => r.id), ['b', 'c', 'a'], 'all zero: activity order');
});

test('sort keys from the URL are validated and start in a sensible direction', () => {
  assert.equal(isSortKey('opens'), true);
  assert.equal(isSortKey('toString'), false);
  assert.equal(isSortKey(''), false);
  assert.equal(defaultDir('name'), 'asc');
  assert.equal(defaultDir('spent'), 'desc');
  assert.equal(defaultDir('lastActive'), 'desc');
});

test('Batch 7: deals at Offer and at Secured are counted per member, other stages ignored', () => {
  const rows = aggregateActivity({
    profiles: [profile('a'), profile('b')],
    opens: [],
    reports: [],
    picks: [],
    debits: [],
    stages: [
      { user_id: 'a', status: 'offer' },
      { user_id: 'a', status: 'offer' },
      { user_id: 'a', status: 'secured' },
      { user_id: 'a', status: 'viewing' },
      { user_id: 'zzz', status: 'offer' },
    ],
  });
  const a = rows.find((r) => r.id === 'a')!;
  const b = rows.find((r) => r.id === 'b')!;
  assert.deepEqual([a.atOffer, a.atSecured, b.atOffer, b.atSecured], [2, 1, 0, 0]);
  assert.ok(isSortKey('offer') && isSortKey('secured'));
  assert.equal(defaultDir('offer'), 'desc');
  assert.deepEqual(sortMembers(rows, 'secured', 'desc').map((r) => r.id), ['a', 'b']);
  // Without stage rows (the list as Batch 1 built it) the counts are zero.
  const bare = aggregateActivity({ profiles: [profile('a')], opens: [], reports: [], picks: [], debits: [] });
  assert.deepEqual([bare[0].atOffer, bare[0].atSecured], [0, 0]);
});
