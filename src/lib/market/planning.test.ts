import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areasToRefresh, meanPlanning, planningByArea, PLANNING_MAX_AGE_DAYS } from './planning.ts';

const NOW = new Date('2026-09-13T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

test('areas with no signal come first, then the stalest; fresh ones are skipped', () => {
  const signals = [
    { postcode_area: 'M', large_apps_12m: 10, large_apps_prev_12m: 8, fetched_at: daysAgo(2) },
    { postcode_area: 'L', large_apps_12m: 5, large_apps_prev_12m: 5, fetched_at: daysAgo(PLANNING_MAX_AGE_DAYS + 5) },
    { postcode_area: 'NG', large_apps_12m: 5, large_apps_prev_12m: 5, fetched_at: daysAgo(PLANNING_MAX_AGE_DAYS + 1) },
  ];
  assert.deepEqual(areasToRefresh(['M', 'L', 'NG', 'BS', 'bs'], signals, NOW), ['BS', 'L', 'NG']);
  assert.deepEqual(areasToRefresh(['M'], signals, NOW), []);
});

test('planningByArea keys by upper-cased code and meanPlanning ignores nulls', () => {
  const m = planningByArea([{ postcode_area: 'ng', large_apps_12m: 3, large_apps_prev_12m: null, fetched_at: null }]);
  assert.equal(m.get('NG')!.large_apps_12m, 3);
  assert.equal(meanPlanning([10, null, 20]), 15);
  assert.equal(meanPlanning([null, undefined]), null);
});
