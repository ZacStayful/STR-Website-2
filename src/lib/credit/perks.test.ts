import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perksFor, perkLines, pickLine, FREE_PERKS, PLAN_PERKS } from './perks.ts';

test('free and unknown plans get the free perks', () => {
  assert.deepEqual(perksFor(null), FREE_PERKS);
  assert.deepEqual(perksFor('nope'), FREE_PERKS);
});

test('every plan, free included, has daily picks', () => {
  assert.equal(FREE_PERKS.sourcingCadence, 'daily');
  for (const code of Object.keys(PLAN_PERKS) as (keyof typeof PLAN_PERKS)[]) {
    assert.equal(PLAN_PERKS[code].sourcingCadence, 'daily', `${code} should be daily`);
  }
});

test('the DB row overrides field by field; junk falls back to the code default', () => {
  assert.equal(perksFor('scale', { sourcingCadence: 'weekly' }).sourcingCadence, 'weekly');
  assert.equal(perksFor('starter', { priorityRefresh: true }).priorityRefresh, true);
  assert.equal(perksFor('starter', { sourcingCadence: 'hourly' as never }).sourcingCadence, 'daily');
});

test('the pick line follows the cadence, so it cannot promise a daily pick to a weekly row', () => {
  assert.equal(pickLine('daily'), 'One property pick a day by email');
  assert.equal(pickLine('weekly'), 'One property pick a week by email');
  assert.equal(perkLines({ ...PLAN_PERKS.starter, sourcingCadence: 'weekly' })[0], 'One property pick a week by email');
});

test('every plan advertises the daily pick line', () => {
  assert.equal(perkLines(FREE_PERKS)[0], 'One property pick a day by email');
  for (const p of Object.values(PLAN_PERKS)) assert.equal(perkLines(p)[0], 'One property pick a day by email');
  assert.ok(perkLines(PLAN_PERKS.scale).includes('Phone support'));
});
