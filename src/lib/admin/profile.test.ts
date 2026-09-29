import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateProfileStats, pctLabel, questionLabel, type QuizFact } from './profile.ts';

const fact = (over: Partial<QuizFact>): QuizFact => ({ userId: 'u', startedAt: '2026-09-20T09:00:00Z', completedAt: null, lastQuestion: null, percent: 0, complete: false, notSure: [], ...over });

test('completion rate, the middle of the incomplete, and where they stop', () => {
  const stats = aggregateProfileStats(
    [
      fact({ userId: 'a', completedAt: '2026-09-21T09:00:00Z', percent: 100, complete: true, lastQuestion: 'growth_target', notSure: ['bedrooms'] }),
      fact({ userId: 'b', percent: 40, lastQuestion: 'time', notSure: ['bedrooms', 'brrr_work'] }),
      fact({ userId: 'c', percent: 20, lastQuestion: 'time' }),
      fact({ userId: 'd', percent: 60, lastQuestion: 'cash_available' }),
      fact({ userId: 'e', startedAt: null, percent: 0 }),
    ],
    10,
  );
  assert.equal(stats.members, 10);
  assert.equal(stats.started, 4, 'a row with no start is not started');
  assert.equal(stats.completed, 1);
  assert.equal(stats.notStarted, 6);
  assert.equal(stats.completionRate, 0.25);
  assert.equal(stats.medianPercent, 40);
  assert.equal(stats.averagePercent, 40);
  assert.deepEqual(stats.dropOff.map((d) => [d.question, d.count]), [['time', 2], ['cash_available', 1]], 'only the incomplete count as stopped');
  assert.equal(stats.dropOff[0].label, 'About you · Time you can give');
  assert.deepEqual(stats.notSure.map((d) => [d.question, d.count]), [['bedrooms', 2], ['brrr_work', 1]]);
});

test('nobody yet: nothing to divide by', () => {
  const stats = aggregateProfileStats([], 3);
  assert.equal(stats.completionRate, null);
  assert.equal(stats.medianPercent, null);
  assert.equal(stats.averagePercent, null);
  assert.equal(stats.notStarted, 3);
  assert.deepEqual(stats.dropOff, []);
  assert.equal(pctLabel(null), '—');
  assert.equal(pctLabel(0.256), '26%');
  assert.equal(questionLabel('budget'), 'About you · Buy and let budget');
});
