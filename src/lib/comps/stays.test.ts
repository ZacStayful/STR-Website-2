import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvgStayNights, readMonthlyOccupancy, readStayProfile, reportAvgStayNights, stayProfile, staySentence, turnoversByMonth } from './stays.ts';
import { monthIndex, windowEndingAt } from './months.ts';
import { makeComp, manchesterComps } from './__fixtures__/report-comps.ts';

const W = windowEndingAt(monthIndex('2026-08'), 36)!;

test('nights per stay are pooled Σnights ÷ Σbookings', () => {
  // Two comps in one month: 10 nights over 2 bookings, 60 nights over... clamp aside,
  // a pooled mean of 2.5 vs an average of per-comp means of 3.5.
  const mk = (occ: number, bookings: number) => ({
    occupancy_rate_ltm_monthly: { '2026-06': occ },
    no_of_bookings_ltm_monthly: { '2026-06': bookings },
    active_days_count_ltm: 350,
  });
  // 30 days × 20% = 6 nights over 3 bookings (2.0); 30 × 50% = 15 nights over 3 bookings (5.0);
  // 30 × 10% = 3 nights over 3 bookings (1.0). Pooled: 24/9 = 2.7; mean of means 2.7 too, so
  // make the weights differ: 30 × 90% = 27 nights over 9 bookings (3.0).
  const p = stayProfile([mk(20, 3), mk(50, 3), mk(90, 9)], W)!;
  assert.equal(p.months[5], Math.round(((6 + 15 + 27) / 15) * 10) / 10);
});

test('established listings are preferred; the part-year one is left out', () => {
  const p = stayProfile(manchesterComps(), W)!;
  assert.equal(p.basis, 'established');
  assert.ok(p.months.every((v) => v !== null && v >= 2.5 && v <= 3.6), JSON.stringify(p.months));
  const few = stayProfile([makeComp('a', { activeDays: 100 }), makeComp('b', { activeDays: 100 }), makeComp('c', { activeDays: 100 })], W)!;
  assert.equal(few.basis, 'all');
});

test('skip rules, too-few months and clamps', () => {
  const one = [makeComp('a'), makeComp('b')];
  assert.equal(stayProfile(one, W), null); // fewer than 3 listings per month
  const odd = [0, 1, 2].map(() => ({
    occupancy_rate_ltm_monthly: { '2026-06': 100, '2026-05': 1 },
    no_of_bookings_ltm_monthly: { '2026-06': 1, '2026-05': 5 },
    active_days_count_ltm: 350,
  }));
  const p = stayProfile(odd, W)!;
  assert.equal(p.months[5], 30); // 30 nights on one booking, clamped
  assert.equal(p.months[4], null); // fewer nights than bookings: skipped
  assert.equal(stayProfile(manchesterComps(), null), null);
});

test('0–1 and 0–100 occupancy scales agree', () => {
  const hundred = [0, 1, 2].map(() => ({ occupancy_rate_ltm_monthly: { '2026-06': 60 }, no_of_bookings_ltm_monthly: { '2026-06': 6 }, active_days_count_ltm: 350 }));
  const unit = [0, 1, 2].map(() => ({ occupancy_rate_ltm_monthly: { '2026-06': 0.6 }, no_of_bookings_ltm_monthly: { '2026-06': 6 }, active_days_count_ltm: 350 }));
  assert.equal(stayProfile(hundred, W)!.months[5], stayProfile(unit, W)!.months[5]);
});

test('leap-year February uses 29 days', () => {
  const w = windowEndingAt(monthIndex('2024-02'), 1)!;
  const c = [0, 1, 2].map(() => ({ occupancy_rate_ltm_monthly: { '2024-02': 100 }, no_of_bookings_ltm_monthly: { '2024-02': 29 }, active_days_count_ltm: 350 }));
  assert.equal(stayProfile(c, w)!.months[1], 1);
});

test('changeovers with and without monthly occupancy', () => {
  const profile = stayProfile(manchesterComps(), W)!;
  const flat = turnoversByMonth({ monthlyOccupancy: null, occupancyRate: 0.7, profile });
  assert.equal(flat.months.length, 12);
  assert.ok(flat.annual! > 50 && flat.annual! < 120, String(flat.annual));
  const monthly = turnoversByMonth({ monthlyOccupancy: new Array(12).fill(0.5), occupancyRate: 0.7, profile });
  assert.ok(monthly.annual! < flat.annual!);
  assert.match(staySentence(profile, flat), /Guests at similar listings stay about \d\.\d nights/);
  assert.match(staySentence(profile, flat), /changeovers a month/);
});

test('legacy average stay is unchanged and still used for old reports', () => {
  const comparables = [
    { bookings: 30, daysAvailable: 300, occupancyRate: 0.6 },
    { bookings: 0, daysAvailable: 300, occupancyRate: 0.6 },
    { bookings: 50, daysAvailable: 365, occupancyRate: 0.5 },
  ];
  const legacy = legacyAvgStayNights(comparables)!;
  assert.equal(legacy, (180 / 30 + 182.5 / 50) / 2);
  assert.equal(reportAvgStayNights({ comparables }), legacy);
  const profile = stayProfile(manchesterComps(), W)!;
  assert.equal(reportAvgStayNights({ comparables, stayProfile: profile }), profile.annual);
  assert.deepEqual(readStayProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.equal(readMonthlyOccupancy([0.5]), null);
  assert.equal(readMonthlyOccupancy(new Array(12).fill(72)), null);
});
