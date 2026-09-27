import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysEnding, recentWeeks, ukDay, ukWeekRange, ukWeekStart, weekDays, weekLabel } from './week.ts';

test('a week starts on Monday, UK time', () => {
  assert.equal(ukWeekStart(new Date('2026-09-28T09:00:00Z')), '2026-09-28'); // Monday
  assert.equal(ukWeekStart(new Date('2026-10-04T12:00:00Z')), '2026-09-28'); // Sunday
  assert.equal(ukWeekStart(new Date('2026-09-27T22:59:59Z')), '2026-09-21'); // Sunday 23:59:59 BST
  assert.equal(ukWeekStart(new Date('2026-09-27T23:00:00Z')), '2026-09-28'); // Monday 00:00 BST
});

test('the week of the clocks going back (25 Oct 2026) is 169 hours', () => {
  const { start, end } = ukWeekRange('2026-10-19');
  assert.equal(start.toISOString(), '2026-10-18T23:00:00.000Z'); // Monday 00:00 BST
  assert.equal(end.toISOString(), '2026-10-26T00:00:00.000Z'); // next Monday 00:00 GMT
  assert.equal((end.getTime() - start.getTime()) / 3_600_000, 169);
  assert.equal(ukWeekStart(new Date('2026-10-25T23:30:00Z')), '2026-10-19'); // Sunday 23:30 GMT: still that week
  assert.equal(ukWeekStart(new Date('2026-10-26T00:00:00Z')), '2026-10-26'); // Monday 00:00 GMT
});

test('the week of the clocks going forward (29 Mar 2026) is 167 hours', () => {
  const { start, end } = ukWeekRange('2026-03-23');
  assert.equal(start.toISOString(), '2026-03-23T00:00:00.000Z');
  assert.equal(end.toISOString(), '2026-03-29T23:00:00.000Z');
  assert.equal((end.getTime() - start.getTime()) / 3_600_000, 167);
  assert.equal(ukWeekStart(new Date('2026-03-29T23:30:00Z')), '2026-03-30');
});

test('UK dates follow Europe/London, not UTC', () => {
  assert.equal(ukDay(new Date('2026-07-01T23:30:00Z')), '2026-07-02');
  assert.equal(ukDay(new Date('2026-01-01T23:30:00Z')), '2026-01-01');
});

test('date arithmetic, week days and windows', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(weekDays('2026-09-28'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  const window = daysEnding('2026-10-04', 30);
  assert.equal(window.length, 30);
  assert.equal(window[0], '2026-09-05');
  assert.equal(window[29], '2026-10-04');
});

test('recent weeks end with the current one, oldest first', () => {
  const weeks = recentWeeks(new Date('2026-09-30T12:00:00Z'), 3);
  assert.deepEqual(weeks, ['2026-09-14', '2026-09-21', '2026-09-28']);
  assert.deepEqual(recentWeeks(new Date(), 0), []);
});

test('a week is labelled by its Monday', () => {
  assert.equal(weekLabel('2026-09-28'), '28 Sept');
});
