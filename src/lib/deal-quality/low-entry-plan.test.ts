import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowEntryAreas, lowEntryQuery, planLowEntry, weekSpentPence, withinWeeklyCap } from './low-entry-plan.ts';
import { DEFAULT_LOW_ENTRY } from './config.ts';

const NOW = new Date('2026-09-30T03:05:00Z'); // a Wednesday; the UK week started Monday 28 Sep

test('every postcode area with a centroid is searched, keyed apart from the sweep', () => {
  const areas = lowEntryAreas();
  assert.ok(areas.length >= 120, `${areas.length} areas`);
  assert.ok(areas.includes('BT'), 'Belfast is placed by hand');
  assert.deepEqual(areas, [...areas].sort());
  const q = lowEntryQuery('cw', DEFAULT_LOW_ENTRY);
  assert.equal(q.key, 'sale|CW||150000|1', 'Batch 22c: the ceiling is £150,000 (was £135,000)');
  assert.equal(q.area, 'CW');
  assert.equal(q.areaName, 'Crewe');
  assert.equal(q.maxPrice, 150_000);
  assert.equal(q.minBedrooms, 1);
  assert.equal(lowEntryQuery('CW', { ...DEFAULT_LOW_ENTRY, minBedrooms: 0 }).minBedrooms, null, 'no floor is no filter');
});

test('never-searched areas go first, then the ones searched longest ago; today’s are skipped', () => {
  const areas = ['AB', 'B', 'CW', 'YO'];
  const key = (a: string) => lowEntryQuery(a, DEFAULT_LOW_ENTRY).key;
  const runs = [
    { startedAt: '2026-09-22T03:00:00Z', doneKeys: [key('YO')], rawCostPence: 2 },
    { startedAt: '2026-09-26T03:00:00Z', doneKeys: [key('B')], rawCostPence: 2 },
    { startedAt: '2026-09-30T03:00:00Z', doneKeys: [key('AB')], rawCostPence: 2.2 },
  ];
  const plan = planLowEntry(areas, runs, DEFAULT_LOW_ENTRY, NOW);
  assert.deepEqual(plan.pending.map((q) => q.area), ['CW', 'YO', 'B'], 'CW never searched, YO on the 22nd, B on the 26th; AB was done today');
  assert.equal(plan.doneToday, 1);
  assert.equal(plan.lastDoneDay.get(key('YO')), '2026-09-22');
  assert.equal(plan.weekStart, '2026-09-28');
  assert.equal(plan.weekSpentPence, 2.2, 'only this week’s run counts');
});

test('the weekly cap counts this UK week’s runs and the next search’s worst case', () => {
  const runs = [
    { startedAt: '2026-09-27T23:30:00Z', rawCostPence: 100 }, // Sunday 28 Sep 00:30 UK time: this week
    { startedAt: '2026-09-27T22:30:00Z', rawCostPence: 50 }, // Sunday 27 Sep 23:30 UK time: last week
    { startedAt: 'nonsense', rawCostPence: 999 },
    { startedAt: '2026-09-29T03:00:00Z', rawCostPence: 'abc' },
  ];
  assert.equal(weekSpentPence(runs, NOW), 100);
  assert.equal(withinWeeklyCap(400, 100, 296, 2.2), true);
  assert.equal(withinWeeklyCap(400, 100, 298, 2.2), false);
  assert.equal(withinWeeklyCap(0, 0, 0, 2.2), false, 'a zero cap searches nothing');
});
