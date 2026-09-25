import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarMonthMeans,
  daysInMonth,
  inWindow,
  latestCompleteMonth,
  monthIndex,
  monthKey,
  monthLabel,
  seasonalMultipliers,
  series,
  UK_DEFAULT_SEASONAL_MULTIPLIERS,
  windowEndingAt,
  windowLabel,
} from './months.ts';
import { manchesterComps } from './__fixtures__/report-comps.ts';

test('month keys round-trip across a year boundary', () => {
  const dec = monthIndex('2025-12')!;
  assert.equal(monthKey(dec + 1), '2026-01');
  assert.equal(monthLabel(dec + 1), 'Jan 2026');
  assert.equal(monthIndex('2026-8'), monthIndex('2026-08'));
  assert.equal(monthIndex('2026-08-01'), monthIndex('2026-08'));
  for (const bad of ['2026-13', '2026-00', 'abc', '']) assert.equal(monthIndex(bad), null);
});

test('days in month knows leap years', () => {
  assert.equal(daysInMonth(monthIndex('2024-02')!), 29);
  assert.equal(daysInMonth(monthIndex('2026-02')!), 28);
  assert.equal(daysInMonth(monthIndex('2026-08')!), 31);
});

test('series keeps positive finite values only', () => {
  const s = series({ '2026-01': 10, '2026-02': null, '2026-03': 0, '2026-04': -1, x: 5 });
  assert.deepEqual([...s.entries()], [[monthIndex('2026-01')!, 10]]);
});

test('anchor is the latest complete month, not the running one', () => {
  const comps = manchesterComps();
  const anchor = latestCompleteMonth(comps.map((c) => c.revenue_ltm_monthly), new Date('2026-09-24T12:00:00Z'));
  assert.equal(monthKey(anchor!), '2026-08');
});

test('a thinly populated trailing month is passed over', () => {
  const dicts = Array.from({ length: 10 }, (_, k) => ({ '2026-06': 1, '2026-07': 1, ...(k < 2 ? { '2026-08': 1 } : {}) }));
  assert.equal(monthKey(latestCompleteMonth(dicts, new Date('2026-09-10'))!), '2026-07');
});

test('anchor after a year boundary, and its 36-month window', () => {
  const anchor = latestCompleteMonth([{ '2026-11': 1, '2026-12': 1, '2027-01': 1 }], new Date('2027-01-10'));
  assert.equal(monthKey(anchor!), '2026-12');
  const w = windowEndingAt(anchor, 36)!;
  assert.equal(windowLabel(w), '2024-01..2026-12');
  assert.equal(inWindow(monthIndex('2024-01')!, w), true);
  assert.equal(inWindow(monthIndex('2023-12')!, w), false);
  assert.equal(inWindow(monthIndex('2027-01')!, w), false);
  assert.equal(inWindow(0, null), true);
});

test('all-null input has no anchor', () => {
  assert.equal(latestCompleteMonth([{ '2026-01': null }, null, undefined], new Date('2026-09-01')), null);
});

test('without a window, the moved helpers match the originals', () => {
  // The pre-move revenueDictToArray / buildSeasonalMultipliers, inlined.
  const legacyMeans = (dict: Record<string, number | null>) => {
    const out = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    for (const [key, value] of Object.entries(dict)) {
      const mi = parseInt(key.split('-')[1], 10) - 1;
      if (mi >= 0 && mi < 12 && typeof value === 'number' && value > 0) { out[mi] += value; counts[mi] += 1; }
    }
    for (let i = 0; i < 12; i++) if (counts[i] > 0) out[i] /= counts[i];
    return out.filter((v) => v > 0).length < 3 ? null : out;
  };
  const comps = manchesterComps();
  for (const c of comps) {
    assert.deepEqual(calendarMonthMeans(c.revenue_ltm_monthly), legacyMeans(c.revenue_ltm_monthly as Record<string, number | null>));
  }
  const pooled = seasonalMultipliers(comps.map((c) => c.occupancy_rate_ltm_monthly));
  assert.equal(pooled.length, 12);
  assert.ok(Math.abs(pooled.reduce((a, b) => a + b, 0) - 12) < 1e-9);
});

test('windowing drops the 2021 lockdown and lifts the spring months', () => {
  const comps = manchesterComps();
  const dicts = comps.map((c) => c.occupancy_rate_ltm_monthly);
  const w = windowEndingAt(monthIndex('2026-08'), 36);
  const all = seasonalMultipliers(dicts);
  const recent = seasonalMultipliers(dicts, w);
  for (const m of [0, 1, 2, 3]) assert.ok(recent[m] > all[m], `month ${m}`);
});

test('too little data falls back to the UK default curve', () => {
  assert.deepEqual(seasonalMultipliers([{ '2026-01': 50, '2026-02': 50 }]), [...UK_DEFAULT_SEASONAL_MULTIPLIERS]);
  assert.equal(calendarMonthMeans({ '2026-01': 5, '2026-02': 5 }), null);
});
