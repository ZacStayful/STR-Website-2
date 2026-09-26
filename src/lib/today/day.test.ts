import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayOrder, finishLine, greeting, isDone, matchLine, tally, todayKey, todayStart, TODAY_SIZE } from './day.ts';

test('the day turns over at 07:00 UTC, the picks email hour, all year', () => {
  assert.equal(todayKey(new Date('2026-09-26T06:59:59Z')), '2026-09-25', 'before seven is still yesterday');
  assert.equal(todayKey(new Date('2026-09-26T07:00:00Z')), '2026-09-26');
  assert.equal(todayKey(new Date('2026-09-26T23:59:59Z')), '2026-09-26');
  // Summer: 07:30 in London is 06:30 UTC, before the email, so still yesterday.
  assert.equal(todayKey(new Date('2026-07-01T06:30:00Z')), '2026-06-30');
  // Winter: 07:30 in London is 07:30 UTC.
  assert.equal(todayKey(new Date('2026-01-15T07:30:00Z')), '2026-01-15');
  assert.equal(todayKey(new Date('2027-01-01T03:00:00Z')), '2026-12-31', 'crosses a year');
  assert.equal(todayStart(new Date('2026-09-26T12:00:00Z')).toISOString(), '2026-09-26T07:00:00.000Z');
  assert.equal(todayStart(new Date('2026-09-26T05:00:00Z')).toISOString(), '2026-09-25T07:00:00.000Z');
});

test('the same moment always gives the same day, so a reload shows the same list', () => {
  const at = new Date('2026-09-26T14:00:00Z');
  assert.equal(todayKey(at), todayKey(new Date(at.getTime())));
  assert.equal(todayKey(new Date('2026-09-26T07:00:00Z')), todayKey(new Date('2026-09-27T06:59:59Z')));
});

test('without a pick the stored list is shown as stored', () => {
  assert.deepEqual(displayOrder(['a', 'b', 'c', 'd', 'e'], null, new Set()), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(displayOrder(['a', 'b'], null, new Set()), ['a', 'b'], 'fewer than five: show what there is');
  assert.deepEqual(displayOrder([], null, new Set()), []);
});

test('the pick comes first and takes the place of the lowest card not yet answered', () => {
  assert.deepEqual(displayOrder(['a', 'b', 'c', 'd', 'e'], 'p', new Set()), ['p', 'a', 'b', 'c', 'd']);
  // e was answered before the pick landed, so d goes instead: an answer never vanishes.
  assert.deepEqual(displayOrder(['a', 'b', 'c', 'd', 'e'], 'p', new Set(['e'])), ['p', 'a', 'b', 'c', 'e']);
  // Everything answered: the pick is added rather than anything dropped.
  assert.deepEqual(displayOrder(['a', 'b', 'c', 'd', 'e'], 'p', new Set(['a', 'b', 'c', 'd', 'e'])), ['p', 'a', 'b', 'c', 'd', 'e']);
  // Room to spare: nothing is dropped.
  assert.deepEqual(displayOrder(['a', 'b'], 'p', new Set()), ['p', 'a', 'b']);
});

test('a pick that is already in the list is not shown twice', () => {
  assert.deepEqual(displayOrder(['a', 'p', 'b'], 'p', new Set()), ['p', 'a', 'b']);
  assert.equal(displayOrder(['a', 'b', 'c', 'd', 'p'], 'p', new Set()).length, TODAY_SIZE);
});

test('done means every card has been kept or passed', () => {
  const answers = new Map<string, 'keep' | 'pass'>([['a', 'keep'], ['b', 'pass'], ['c', 'keep']]);
  assert.equal(isDone(['a', 'b', 'c'], answers), true);
  assert.equal(isDone(['a', 'b', 'c', 'd'], answers), false);
  assert.equal(isDone([], answers), false, 'an empty day is not a finished one');
  assert.deepEqual(tally(['a', 'b', 'c', 'd'], answers), { kept: 2, passed: 1 });
  assert.equal(finishLine({ kept: 3, passed: 2 }), 'You’re done for today. 3 kept, 2 passed.');
});

test('the greeting follows the clock in the UK and uses the first name only', () => {
  assert.equal(greeting(new Date('2026-09-26T07:30:00Z'), 'Sam Jones'), 'Good morning, Sam');
  // 11:30 UTC is 12:30 in London in summer.
  assert.equal(greeting(new Date('2026-07-01T11:30:00Z'), 'Sam'), 'Good afternoon, Sam');
  assert.equal(greeting(new Date('2026-01-15T19:00:00Z'), null), 'Good evening');
  assert.equal(greeting(new Date('2026-01-15T09:00:00Z'), '   '), 'Good morning');
});

test('the match line is the real count, worded for one or many', () => {
  assert.equal(matchLine(342, true), '342 deals match what you’re looking for');
  assert.equal(matchLine(1, true), '1 deal matches what you’re looking for');
  assert.equal(matchLine(0, true), '0 deals match what you’re looking for');
  assert.equal(matchLine(12_450, true), '12,450 deals match what you’re looking for');
  assert.equal(matchLine(80, false), '80 deals on the market in Stayful’s top areas');
  assert.equal(matchLine(null, true), null, 'a count that could not be read says nothing rather than zero');
});
