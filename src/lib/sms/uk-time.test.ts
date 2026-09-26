import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSendingWindow, londonDay, londonMonthStart, londonParts } from './uk-time.ts';

const at = (iso: string) => new Date(iso);

test('winter (GMT): the window is 08:00–19:59 UTC', () => {
  assert.equal(inSendingWindow(at('2026-01-15T07:59:00Z')), false);
  assert.equal(inSendingWindow(at('2026-01-15T08:00:00Z')), true);
  assert.equal(inSendingWindow(at('2026-01-15T19:59:00Z')), true);
  assert.equal(inSendingWindow(at('2026-01-15T20:00:00Z')), false);
});

test('summer (BST): the window is 07:00–18:59 UTC', () => {
  assert.equal(inSendingWindow(at('2026-07-15T06:59:00Z')), false);
  assert.equal(inSendingWindow(at('2026-07-15T07:00:00Z')), true); // 08:00 BST
  assert.equal(inSendingWindow(at('2026-07-15T18:59:00Z')), true); // 19:59 BST
  assert.equal(inSendingWindow(at('2026-07-15T19:00:00Z')), false); // 20:00 BST
});

test('clocks go forward (29 Mar 2026, 01:00 UTC): 07:30 UTC that morning is 08:30 BST', () => {
  assert.equal(londonParts(at('2026-03-29T00:59:00Z')).hour, 0);
  assert.equal(londonParts(at('2026-03-29T01:00:00Z')).hour, 2);
  assert.equal(inSendingWindow(at('2026-03-29T07:30:00Z')), true);
  assert.equal(inSendingWindow(at('2026-03-28T07:30:00Z')), false); // the day before, still GMT
  assert.equal(inSendingWindow(at('2026-03-29T19:00:00Z')), false); // 20:00 BST
});

test('clocks go back (25 Oct 2026, 01:00 UTC): 07:30 UTC that morning is 07:30 GMT', () => {
  assert.equal(inSendingWindow(at('2026-10-24T07:30:00Z')), true); // 08:30 BST
  assert.equal(inSendingWindow(at('2026-10-25T07:30:00Z')), false); // 07:30 GMT
  assert.equal(inSendingWindow(at('2026-10-25T19:30:00Z')), true); // 19:30 GMT
  assert.equal(inSendingWindow(at('2026-10-24T19:30:00Z')), false); // 20:30 BST
});

test('the UK day and month roll over at UK midnight, not UTC', () => {
  assert.equal(londonDay(at('2026-06-30T23:30:00Z')), '2026-07-01'); // 00:30 BST
  assert.equal(londonMonthStart(at('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.equal(londonDay(at('2026-12-31T23:30:00Z')), '2026-12-31'); // GMT
  assert.equal(londonMonthStart(at('2026-12-31T23:30:00Z')), '2026-12-01');
});
