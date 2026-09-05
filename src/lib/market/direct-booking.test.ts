import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaDirectBooking, directBookingLabel } from './direct-booking.ts';

const base = { sample_count: 10, share_hospital: null, share_university: null, share_transport: null, avg_events: null, large_planning_apps_12m: null, large_planning_apps_prev_12m: null, planning_fetched_at: null };

test('null when nothing is known', () => {
  assert.equal(areaDirectBooking(null), null);
  assert.equal(areaDirectBooking(base), null);
});

test('full marks everywhere → 100, Strong', () => {
  const d = areaDirectBooking({ ...base, share_hospital: 1, share_university: 1, share_transport: 1, avg_events: 150, large_planning_apps_12m: 60 })!;
  assert.equal(d.score, 100);
  assert.equal(d.label, 'Strong');
  assert.equal(d.components.length, 5);
});

test('missing inputs are dropped and renormalised', () => {
  const d = areaDirectBooking({ ...base, share_hospital: 0.5 })!; // 12.5 of 25 → 50
  assert.equal(d.score, 50);
  assert.equal(d.components.filter((c) => c.earned === null).length, 4);
});

test('contractor weight dominates when planning data is present', () => {
  const withApps = areaDirectBooking({ ...base, share_hospital: 0, large_planning_apps_12m: 40 })!;
  assert.equal(withApps.score, Math.round((30 / 55) * 100));
});

test('contractor trend compares the two windows', () => {
  assert.equal(areaDirectBooking({ ...base, large_planning_apps_12m: 20, large_planning_apps_prev_12m: 10 })!.contractorTrend, 'up');
  assert.equal(areaDirectBooking({ ...base, large_planning_apps_12m: 10, large_planning_apps_prev_12m: 20 })!.contractorTrend, 'down');
  assert.equal(areaDirectBooking({ ...base, large_planning_apps_12m: 10, large_planning_apps_prev_12m: 10 })!.contractorTrend, 'flat');
  assert.equal(areaDirectBooking({ ...base, large_planning_apps_12m: 10 })!.contractorTrend, null);
});

test('labels', () => {
  assert.equal(directBookingLabel(34), 'Low');
  assert.equal(directBookingLabel(35), 'Moderate');
  assert.equal(directBookingLabel(60), 'Strong');
});
