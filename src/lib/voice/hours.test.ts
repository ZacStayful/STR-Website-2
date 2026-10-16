import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inOutboundHours, nextDayOpening, nextOpening, readyAt, ukDay, ukWeekday } from './hours.ts';
import { DEFAULT_VOICE } from './settings.ts';

const at = (iso: string) => new Date(iso);
const s = DEFAULT_VOICE;

test('weekday in the UK', () => {
  assert.equal(ukWeekday(at('2026-10-05T10:00:00Z')), 1); // Monday
  assert.equal(ukWeekday(at('2026-10-04T23:30:00Z')), 1); // Sunday 23:30 UTC = Monday 00:30 BST
  assert.equal(ukWeekday(at('2026-10-11T12:00:00Z')), 7);
});

test('weekdays 9am–7pm UK only', () => {
  assert.equal(inOutboundHours(at('2026-10-05T08:00:00Z'), s), true); // 09:00 BST Monday
  assert.equal(inOutboundHours(at('2026-10-05T07:59:00Z'), s), false);
  assert.equal(inOutboundHours(at('2026-10-05T17:59:00Z'), s), true); // 18:59 BST
  assert.equal(inOutboundHours(at('2026-10-05T18:00:00Z'), s), false); // 19:00 BST
  assert.equal(inOutboundHours(at('2026-12-07T09:00:00Z'), s), true); // 09:00 GMT
  assert.equal(inOutboundHours(at('2026-12-07T08:59:00Z'), s), false);
  assert.equal(inOutboundHours(at('2026-10-10T12:00:00Z'), s), false); // Saturday
  assert.equal(inOutboundHours(at('2026-10-11T12:00:00Z'), s), false); // Sunday
});

test('next opening', () => {
  const inside = at('2026-10-05T12:34:00Z');
  assert.equal(nextOpening(inside, s).getTime(), inside.getTime());
  assert.equal(nextOpening(at('2026-10-05T19:30:00Z'), s).toISOString(), '2026-10-06T08:00:00.000Z'); // Mon 20:30 → Tue 09:00 BST
  assert.equal(nextOpening(at('2026-10-09T18:30:00Z'), s).toISOString(), '2026-10-12T08:00:00.000Z'); // Fri 19:30 → Mon 09:00
  assert.equal(nextOpening(at('2026-10-24T12:00:00Z'), s).toISOString(), '2026-10-26T09:00:00.000Z'); // Sat → Mon 09:00 GMT (clocks went back)
});

test('next day\'s opening when today\'s call is used', () => {
  assert.equal(nextDayOpening(at('2026-10-05T10:00:00Z'), s).toISOString(), '2026-10-06T08:00:00.000Z');
  assert.equal(nextDayOpening(at('2026-10-09T10:00:00Z'), s).toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(nextDayOpening(at('2026-10-05T06:00:00Z'), s).toISOString(), '2026-10-06T08:00:00.000Z'); // before opening: still tomorrow
});

test('ukDay is the London date', () => {
  assert.equal(ukDay(at('2026-10-04T23:30:00Z')), '2026-10-05');
});

test('a delayed call is ready after its delay, or at the opening after it (R3-23)', () => {
  const inside = at('2026-10-05T12:34:00Z');
  assert.equal(readyAt(inside, 5 * 60_000, s).toISOString(), '2026-10-05T12:39:00.000Z');
  assert.equal(readyAt(inside, 0, s).getTime(), inside.getTime());
  assert.equal(readyAt(at('2026-10-05T17:57:00Z'), 5 * 60_000, s).toISOString(), '2026-10-06T08:00:00.000Z'); // 18:57 BST + 5 min is past 19:00 → Tue 09:00
  assert.equal(readyAt(at('2026-10-05T06:00:00Z'), 5 * 60_000, s).toISOString(), '2026-10-05T08:00:00.000Z'); // 07:00 BST → 09:00
  assert.equal(readyAt(at('2026-10-09T17:58:00Z'), 5 * 60_000, s).toISOString(), '2026-10-12T08:00:00.000Z'); // Fri 18:58 BST → Mon 09:00
});
