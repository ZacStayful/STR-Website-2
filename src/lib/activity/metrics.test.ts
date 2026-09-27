import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeklyActive, emptyFacts, exclusionFor, formatDuration, median, pct, ratio, type FactMember, type WeeklyFacts } from './metrics.ts';

const W1 = '2026-09-14';
const W2 = '2026-09-21';
const W3 = '2026-09-28';

function member(id: string, over: Partial<FactMember> = {}): FactMember {
  return {
    id,
    email: `${id}@example.com`,
    name: id.toUpperCase(),
    created_at: '2026-09-01T00:00:00Z',
    plan: 'free',
    plan_code: null,
    plan_source: null,
    status: null,
    sub_started: null,
    sub_ended: null,
    paused_from: null,
    paused_until: null,
    owner: null,
    ...over,
  };
}

function facts(over: Partial<WeeklyFacts> = {}): WeeklyFacts {
  return {
    now: '2026-09-30T12:00:00Z',
    first_week: W1,
    this_week: W3,
    weeks: 3,
    tracking_since: '2026-09-22T10:00:00Z',
    visits_since: '2026-09-29T08:00:00Z',
    members: [
      member('a'),
      member('b'),
      member('c', { email: 'zac@stayful.co.uk' }),
      member('d', { email: 'someone@stayful.co.uk' }),
      member('e'),
      member('f', { owner: 'a' }),
      member('g', { created_at: '2026-09-25T00:00:00Z' }),
      member('h', { status: 'active', sub_started: '2026-05-01T00:00:00Z', paused_from: '2026-09-20T00:00:00Z', paused_until: '2026-11-01T00:00:00Z' }),
    ],
    excluded: [{ u: 'e', reason: 'test account' }],
    payments: [{ u: 'a', first: '2026-09-02T00:00:00Z', before: null, list: ['2026-09-02T00:00:00Z'] }],
    sub_events: [],
    qdays: [
      { u: 'a', d: ['2026-09-22', '2026-09-29'] },
      { u: 'b', d: ['2026-09-30'] },
      { u: 'c', d: ['2026-09-29'] },
      { u: 'e', d: ['2026-09-29'] },
      { u: 'f', d: ['2026-09-29'] },
    ],
    weekly: [
      { u: 'a', w: W3, c: 5, r: 2 },
      { u: 'b', w: W3, c: 1, r: 1 },
      { u: 'c', w: W3, c: 9, r: 9 },
    ],
    visits: [
      { u: 'a', w: W3, n: 2, a: 5, s: [60, 120] },
      { u: 'b', w: W3, n: 1, a: 1, s: [30] },
      { u: 'c', w: W3, n: 7, a: 9, s: [1, 1, 1, 1, 1, 1, 1] },
    ],
    opens: [{ u: 'a', w: W2, n: 2, m: 2, c: 1, cm: 1 }],
    today: [
      { u: 'a', w: W3, shown: 5, kept: 2 },
      { u: 'c', w: W3, shown: 5, kept: 5 },
    ],
    last: [
      { u: 'a', k: 'keep', at: '2026-09-29T09:00:00Z' },
      { u: 'b', k: 'report_run', at: '2026-09-30T09:00:00Z' },
    ],
    ...over,
  };
}

const ADMINS = ['zac@stayful.co.uk'];

test('admin, staff and switched-off accounts are left out, with the reason', () => {
  const report = computeWeeklyActive(facts(), { adminEmails: ADMINS });
  assert.deepEqual(report.excluded.map((x) => [x.id, x.reason, x.note]), [
    ['c', 'admin', null],
    ['d', 'staff', null],
    ['e', 'manual', 'test account'],
  ]);
  assert.ok(!report.members.some((m) => ['c', 'd', 'e'].includes(m.id)));
});

test('exclusion matches emails exactly, whatever the case', () => {
  const admins = new Set(['zac@stayful.co.uk']);
  assert.equal(exclusionFor(' ZAC@Stayful.co.uk ', undefined, admins), 'admin');
  assert.equal(exclusionFor('zac_x@stayful.co.uk', undefined, new Set()), 'staff');
  assert.equal(exclusionFor('zac@stayful.co.uk.evil.com', undefined, new Set()), null);
  assert.equal(exclusionFor(null, null, admins), 'manual');
  assert.equal(exclusionFor('x@y.com', undefined, admins), null);
});

test('this week: members, weekly active and the billing groups', () => {
  const week = computeWeeklyActive(facts(), { adminEmails: ADMINS }).weeks.find((w) => w.week === W3)!;
  assert.equal(week.current, true);
  // a, b, f, g, h count (c, d, e are excluded); a, b and f were active.
  assert.deepEqual(week.members, { base: 5, active: 3 });
  // a topped up; f is on a's team, so is paying with them.
  assert.deepEqual(week.paying, { base: 2, active: 2 });
  assert.deepEqual(week.activePaying, { base: 2, active: 2 });
  assert.deepEqual(week.paused, { base: 1, active: 0 });
  assert.deepEqual(week.cancelled, { base: 0, active: 0 });
});

test('a member counts from the week they joined', () => {
  const w1 = computeWeeklyActive(facts(), { adminEmails: ADMINS }).weeks.find((w) => w.week === W1)!;
  // g joined in week 2: not in week 1's base.
  assert.equal(w1.members.base, 4);
});

test('visits, actions per visit and the median visit, excluded accounts left out', () => {
  const week = computeWeeklyActive(facts(), { adminEmails: ADMINS }).weeks.find((w) => w.week === W3)!;
  assert.deepEqual(week.visits, { total: 3, byActive: 3, actions: 6, medianSeconds: 60 });
  assert.deepEqual(week.reports, { total: 3, byActive: 3 });
  assert.deepEqual(week.keep, { shown: 5, kept: 2 });
});

test('before visits existed, visit figures are empty rather than zero', () => {
  const report = computeWeeklyActive(facts(), { adminEmails: ADMINS });
  assert.equal(report.weeks.find((w) => w.week === W1)!.visits, null);
  assert.equal(report.weeks.find((w) => w.week === W2)!.visits, null);
});

test('how much of each week live tracking covers', () => {
  const report = computeWeeklyActive(facts(), { adminEmails: ADMINS });
  assert.deepEqual(report.weeks.map((w) => w.tracked), ['none', 'partial', 'full']);
  assert.equal(report.weeks[0].keep, null);
  assert.deepEqual(report.weeks[1].openToReport, { opens: 2, matured: 2, reported: 1, reportedMatured: 1 });
});

test('Active paying needs a recent payment and activity in the last 30 days', () => {
  const quiet = facts({
    payments: [{ u: 'a', first: '2026-03-01T00:00:00Z', before: '2026-03-01T00:00:00Z', list: [] }],
    qdays: [{ u: 'a', d: ['2026-09-29'] }],
  });
  const week = computeWeeklyActive(quiet, { adminEmails: ADMINS }).weeks.find((w) => w.week === W3)!;
  // a has paid, so is paying, but not in the last 90 days: not Active paying.
  assert.equal(week.paying.base, 2);
  assert.equal(week.activePaying.base, 0);
});

test('the drill-down: eight weeks at most, newest action first', () => {
  const report = computeWeeklyActive(facts(), { adminEmails: ADMINS });
  assert.deepEqual(report.members.slice(0, 2).map((m) => m.id), ['b', 'a']);
  const a = report.members.find((m) => m.id === 'a')!;
  assert.equal(a.category, 'paying');
  assert.equal(a.lastAction?.label, 'Kept a deal');
  assert.deepEqual(a.weeks.map((w) => [w.week, w.active, w.visits, w.actions]), [
    [W1, false, 0, 0],
    [W2, true, 0, 0],
    [W3, true, 2, 5],
  ]);
  const g = report.members.find((m) => m.id === 'g')!;
  assert.equal(g.lastAction, null);
});

test('no data at all: every figure is empty, nothing throws', () => {
  const report = computeWeeklyActive(emptyFacts(new Date('2026-09-30T12:00:00Z'), W3, 12), { adminEmails: ADMINS });
  assert.equal(report.weeks.length, 12);
  assert.equal(report.weeks[11].week, W3);
  for (const w of report.weeks) {
    assert.deepEqual(w.members, { base: 0, active: 0 });
    assert.equal(w.visits, null);
    assert.equal(w.keep, null);
    assert.equal(pct(w.members), '—');
  }
  assert.deepEqual(report.members, []);
});

test('number helpers', () => {
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(1, 4), 0.25);
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(pct({ base: 3, active: 1 }), '33%');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(200), '3 min 20 s');
  assert.equal(formatDuration(3900), '1 h 5 min');
});
