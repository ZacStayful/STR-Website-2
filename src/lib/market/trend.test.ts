import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendDirection, areaTrend, pulse, formatMonth } from './trend.ts';
import type { MonthBucket } from './types.ts';

const b = (month: string, reports: number, adr: number | null = 100): MonthBucket => ({ month, reports, avg_adr: adr, avg_occupancy: 60, avg_gross_revenue: 20000 });

test('value trend needs two qualifying months on each side', () => {
  const thin = [b('2026-01', 1), b('2026-02', 1), b('2026-03', 5), b('2026-04', 5), b('2026-05', 5), b('2026-06', 5)];
  assert.equal(trendDirection(thin, 'avg_adr').direction, 'insufficient');
  const enough = [b('2026-01', 5, 100), b('2026-02', 5, 100), b('2026-03', 5, 100), b('2026-04', 5, 110), b('2026-05', 5, 110), b('2026-06', 5, 110)];
  const t = trendDirection(enough, 'avg_adr');
  assert.equal(t.direction, 'up');
  assert.equal(t.deltaPct, 0.1);
  assert.equal(t.monthsUsed, 6);
});

test('thin months are skipped, not counted as zero', () => {
  const s = [b('2026-01', 5, 100), b('2026-02', 5, 100), b('2026-03', 1, 5), b('2026-04', 5, 100), b('2026-05', 5, 100), b('2026-06', 1, 999), b('2026-07', 5, 100), b('2026-08', 5, 100)];
  const t = trendDirection(s, 'avg_adr');
  assert.equal(t.direction, 'flat'); // the 5 and 999 outliers never enter
  assert.equal(t.monthsUsed, 6);
  // four qualifying months is one short of a prior window
  assert.equal(trendDirection(s.slice(0, 5), 'avg_adr').direction, 'insufficient');
});

test('flat band', () => {
  const s = [b('2026-01', 5, 100), b('2026-02', 5, 100), b('2026-03', 5, 100), b('2026-04', 5, 102), b('2026-05', 5, 102), b('2026-06', 5, 102)];
  assert.equal(trendDirection(s, 'avg_adr').direction, 'flat');
  assert.equal(trendDirection(s, 'avg_adr', { flatBand: 0.01 }).direction, 'up');
});

test('enquiry trend compares positional windows and needs a baseline', () => {
  const s = [b('2026-01', 0), b('2026-02', 1), b('2026-03', 1), b('2026-04', 4), b('2026-05', 4), b('2026-06', 4)];
  assert.equal(trendDirection(s, 'reports').direction, 'insufficient'); // prior window has 2 < 3
  const s2 = [b('2026-01', 2), b('2026-02', 2), b('2026-03', 2), b('2026-04', 1), b('2026-05', 1), b('2026-06', 1)];
  const t = trendDirection(s2, 'reports');
  assert.equal(t.direction, 'down');
  assert.equal(t.deltaPct, -0.5);
});

test('areaTrend summarises and records since/monthsWithData', () => {
  const s = [b('2026-01', 0), b('2026-02', 3), b('2026-03', 4)];
  const a = areaTrend(s)!;
  assert.equal(a.since, '2026-02');
  assert.equal(a.monthsWithData, 2);
  assert.equal(a.enquiries.direction, 'insufficient');
  assert.equal(areaTrend(undefined), null);
});

test('areaTrend ignores the running (last) month so a steady area never reads as a drop mid-month', () => {
  const steady = [b('2026-03', 5), b('2026-04', 5), b('2026-05', 5), b('2026-06', 5), b('2026-07', 5), b('2026-08', 5), b('2026-09', 1)];
  const a = areaTrend(steady)!;
  assert.equal(a.enquiries.direction, 'flat');
  assert.equal(a.enquiries.recentMonths, 3);
  assert.equal(a.enquiries.priorMonths, 3);
  // trendDirection itself keeps the last month unless told otherwise
  assert.equal(trendDirection(steady, 'reports').direction, 'down');
});

test('pulse: last full month vs the one before, running month separate', () => {
  const s = [b('2026-05', 10, 120), b('2026-06', 10, 125), b('2026-07', 10, 130), b('2026-08', 15, 131), b('2026-09', 2, null)];
  const p = pulse(s)!;
  assert.equal(p.thisMonth, 2);
  assert.equal(p.lastMonth, 15);
  assert.equal(p.prevMonth, 10);
  assert.equal(p.enquiries.direction, 'up');
  assert.equal(p.enquiries.deltaPct, 0.5);
  assert.equal(p.since, '2026-05');
  assert.equal(p.latestAdr, 131);
  assert.equal(pulse([b('2026-09', 1)]), null);
});

test('formatMonth', () => {
  assert.equal(formatMonth('2026-09'), 'Sep 2026');
});
