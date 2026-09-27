import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MemberRow, WeekMetrics } from './metrics.ts';
import { actionsPerVisit, drillMembers, GROUPS, HEADLINE_GROUPS, keepRate, medianVisit, memberWeeks, onTarget, openToReport, reportsPerActive, shareCell, trackingNote, trendPanels, visitsPerActive } from './view.ts';

const none = { base: 0, active: 0 };

function week(over: Partial<WeekMetrics> = {}): WeekMetrics {
  return {
    week: '2026-09-21',
    label: '21 Sept',
    current: false,
    tracked: 'full',
    members: { base: 20, active: 8 },
    paying: { base: 10, active: 6 },
    activePaying: { base: 5, active: 4 },
    paused: none,
    cancelled: { base: 2, active: 0 },
    visits: { total: 30, byActive: 24, actions: 150, medianSeconds: 200 },
    openToReport: { opens: 0, matured: 0, reported: 0, reportedMatured: 0 },
    reports: { total: 10, byActive: 6 },
    keep: { shown: 15, kept: 3 },
    ...over,
  };
}

test('every percentage carries its counts; an empty group is a dash', () => {
  assert.equal(shareCell({ base: 19, active: 8 }), '42% · 8 of 19');
  assert.equal(shareCell(none), '—');
  assert.equal(onTarget({ base: 10, active: 4 }, 40), true);
  assert.equal(onTarget({ base: 10, active: 3 }, 40), false);
  assert.equal(onTarget({ base: 10, active: 3 }, null), null);
  assert.equal(onTarget(none, 40), null);
});

test('the groups and targets are the agreed ones', () => {
  assert.deepEqual(GROUPS.map((g) => [g.key, g.target]), [['members', 40], ['paying', 60], ['activePaying', 60], ['paused', null], ['cancelled', null]]);
  assert.deepEqual(HEADLINE_GROUPS.map((g) => g.key), ['members', 'paying', 'activePaying']);
});

test('usage per week', () => {
  const w = week();
  assert.equal(visitsPerActive(w), '3.0');
  assert.equal(actionsPerVisit(w), '5.0');
  assert.equal(medianVisit(w), '3 min 20 s');
  assert.equal(reportsPerActive(w), '0.8');
  assert.equal(keepRate(w), '20% · 3 of 15');
  // Before visits or Today views were recorded, and with nobody active.
  const early = week({ visits: null, keep: null, members: { base: 20, active: 0 } });
  assert.equal(visitsPerActive(early), '—');
  assert.equal(actionsPerVisit(early), '—');
  assert.equal(medianVisit(early), '—');
  assert.equal(reportsPerActive(early), '—');
  assert.equal(keepRate(early), '—');
  assert.equal(keepRate(week({ keep: { shown: 0, kept: 0 } })), '—');
});

test('opens too young for their 14 days are still counting, never misses', () => {
  assert.deepEqual(openToReport(week()), { value: '—', note: null });
  assert.deepEqual(openToReport(week({ openToReport: { opens: 3, matured: 0, reported: 1, reportedMatured: 0 } })), { value: 'still counting', note: '3 opens under 14 days old' });
  assert.deepEqual(openToReport(week({ openToReport: { opens: 1, matured: 0, reported: 0, reportedMatured: 0 } })).note, '1 open under 14 days old');
  assert.deepEqual(openToReport(week({ openToReport: { opens: 5, matured: 4, reported: 2, reportedMatured: 1 } })), { value: '25% · 1 of 4', note: '1 more still counting' });
  assert.deepEqual(openToReport(week({ openToReport: { opens: 4, matured: 4, reported: 2, reportedMatured: 2 } })), { value: '50% · 2 of 4', note: null });
});

test('weeks the live log does not fully cover say so', () => {
  assert.equal(trackingNote(week({ tracked: 'none' })), 'Backfilled history only (undercounts)');
  assert.equal(trackingNote(week({ tracked: 'partial' })), 'Live tracking started this week');
  assert.equal(trackingNote(week()), null);
});

test('the trend plots only weeks with live tracking', () => {
  const panels = trendPanels([week({ tracked: 'none', label: '14 Sept' }), week({ tracked: 'partial' }), week({ current: true, label: '28 Sept', paying: none })]);
  assert.deepEqual(panels.map((p) => [p.title, p.target]), [['All members', 40], ['Paying', 60], ['Active paying', 60]]);
  assert.deepEqual(panels[0].points.map((p) => p.pct), [null, 40, 40]);
  // Counts are kept for the tooltip, even where nothing is plotted.
  assert.deepEqual(panels[0].points[0], { label: '14 Sept', pct: null, active: 8, base: 20, current: false, tracked: 'none' });
  // Nobody paying that week: nothing to plot, not 0%.
  assert.equal(panels[1].points[2].pct, null);
  assert.equal(panels[2].points[1].pct, 80);
});

test('the drill-down lists members who did anything, or everyone', () => {
  const row = (id: string, weeks: MemberRow['weeks']): MemberRow => ({ id, email: `${id}@example.com`, name: null, joined: null, category: 'never_paid', paidRecently: false, weeks, lastAction: null });
  const quiet = row('quiet', [{ week: '2026-09-21', active: false, visits: 0, actions: 0 }]);
  const visitor = row('visitor', [{ week: '2026-09-21', active: false, visits: 2, actions: 0 }]);
  const active = row('active', [{ week: '2026-09-21', active: true, visits: 1, actions: 3 }]);
  assert.deepEqual(drillMembers([quiet, visitor, active], false).map((r) => r.id), ['visitor', 'active']);
  assert.deepEqual(drillMembers([quiet, visitor, active], true).map((r) => r.id), ['quiet', 'visitor', 'active']);
});

test('weeks before a member joined are not weeks they missed', () => {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'].map((week) => ({ week, active: false, visits: 0, actions: 0 }));
  const row = (joined: string | null): MemberRow => ({ id: 'm', email: null, name: null, joined, category: 'never_paid', paidRecently: false, weeks, lastAction: null });
  // Joined on the Sunday evening that ends the week of 14 Sept (UK time).
  assert.deepEqual(memberWeeks(row('2026-09-20T20:00:00Z')).map((w) => w.member), [false, true, true]);
  // Just after that week ended (Monday 00:00 in London is 23:00 UTC on Sunday).
  assert.deepEqual(memberWeeks(row('2026-09-20T23:00:00Z')).map((w) => w.member), [false, false, true]);
  assert.deepEqual(memberWeeks(row(null)).map((w) => w.member), [true, true, true]);
});
