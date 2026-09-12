import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perksFor, sourcingRunsToday, FREE_PERKS } from './perks.ts';

test('free and unknown plans get the free perks', () => {
  assert.deepEqual(perksFor(null), FREE_PERKS);
  assert.deepEqual(perksFor('nope'), FREE_PERKS);
});

test('scale gets the daily digest; the DB row overrides', () => {
  assert.equal(perksFor('scale').sourcingCadence, 'daily');
  assert.equal(perksFor('scale', { sourcingCadence: 'weekly' }).sourcingCadence, 'weekly');
  assert.equal(perksFor('starter', { priorityRefresh: true }).priorityRefresh, true);
});

test('weekly cadence only runs on Mondays (UTC)', () => {
  assert.equal(sourcingRunsToday('weekly', new Date('2026-09-14T07:00:00Z')), true); // Monday
  assert.equal(sourcingRunsToday('weekly', new Date('2026-09-15T07:00:00Z')), false);
  assert.equal(sourcingRunsToday('daily', new Date('2026-09-15T07:00:00Z')), true);
});
