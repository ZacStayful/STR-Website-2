import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeKeepsActive, homeOnlyWeeks } from './home-only.ts';
import { ACTIVITY_KINDS, QUALIFYING_KINDS } from './kinds.ts';

const S = { inactiveReengageDays: 14, picksPauseInactiveDays: 25, inactivityFrom: '2026-08-01T00:00:00Z' };
const NOW = new Date('2026-10-02T12:00:00Z');

test('home_view counts towards weekly active; Home and Browse taps are record only; a Browse filter change counts', () => {
  assert.ok(QUALIFYING_KINDS.includes('home_view'));
  assert.ok(QUALIFYING_KINDS.includes('browse_filter'));
  assert.equal(ACTIVITY_KINDS.home_tile_tap.qualifying, false);
  assert.equal(ACTIVITY_KINDS.home_feed_tap.qualifying, false);
});

test('members active only because of Home: with less without, per week', () => {
  const w = (week: string, active: number) => ({ week, label: week, members: { base: 10, active } }) as never;
  assert.deepEqual(homeOnlyWeeks([w('2026-09-21', 5), w('2026-09-28', 7)], [w('2026-09-21', 5), w('2026-09-28', 4)]), [
    { week: '2026-09-21', label: '2026-09-21', members: 0 },
    { week: '2026-09-28', label: '2026-09-28', members: 3 },
  ]);
});

test('logging in (Home) now resets the 14-day quiet and the 25-day picks pause', () => {
  const base = { createdAt: '2026-08-01T00:00:00Z', eligible: true };
  assert.deepEqual(homeKeepsActive({ ...base, lastHomeDay: '2026-10-01', lastOtherDay: '2026-09-01' }, S, NOW), { quiet: true, paused: true });
  assert.deepEqual(homeKeepsActive({ ...base, lastHomeDay: '2026-10-01', lastOtherDay: '2026-09-15' }, S, NOW), { quiet: true, paused: false });
  assert.deepEqual(homeKeepsActive({ ...base, lastHomeDay: '2026-10-01', lastOtherDay: '2026-09-30' }, S, NOW), { quiet: false, paused: false });
  assert.deepEqual(homeKeepsActive({ ...base, eligible: false, lastHomeDay: '2026-10-01', lastOtherDay: null }, S, NOW), { quiet: false, paused: false }, 'members on a plan are never quiet');
});
