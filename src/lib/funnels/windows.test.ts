import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayWindow, minuteWindow, ipBucket, capMessage, IP_WINDOW_MINUTES } from './windows.ts';

test('the daily window is UTC midnight, so caps do not drift with the server clock', () => {
  const w = dayWindow(new Date('2026-09-19T23:59:59.999Z'));
  assert.equal(w, '2026-09-19T00:00:00.000Z');
  // One millisecond later is a new day, and a fresh allowance.
  assert.equal(dayWindow(new Date('2026-09-20T00:00:00.000Z')), '2026-09-20T00:00:00.000Z');
});

test('every moment in a day maps to the same window', () => {
  const a = dayWindow(new Date('2026-09-19T00:00:01Z'));
  const b = dayWindow(new Date('2026-09-19T12:34:56Z'));
  assert.equal(a, b);
});

test('minute windows are fixed buckets, not a rolling offset', () => {
  // Anything inside the same 10 minutes shares a key, so the counter is stable.
  assert.equal(minuteWindow(10, new Date('2026-09-19T10:00:00Z')), '2026-09-19T10:00:00.000Z');
  assert.equal(minuteWindow(10, new Date('2026-09-19T10:09:59Z')), '2026-09-19T10:00:00.000Z');
  assert.equal(minuteWindow(10, new Date('2026-09-19T10:10:00Z')), '2026-09-19T10:10:00.000Z');
});

test('the default IP window matches the exported constant', () => {
  const now = new Date('2026-09-19T10:07:00Z');
  assert.equal(minuteWindow(undefined, now), minuteWindow(IP_WINDOW_MINUTES, now));
});

test('an IP is a bucket key and is length-capped', () => {
  assert.equal(ipBucket('1.2.3.4'), 'ip:1.2.3.4');
  // A long forwarded header cannot blow up the primary key.
  assert.ok(ipBucket('x'.repeat(500)).length <= 67);
});

test('the prospect is never told about the customer’s balance or caps', () => {
  for (const v of ['daily_cap', 'spend_cap', 'unavailable'] as const) {
    const m = capMessage(v);
    assert.doesNotMatch(m, /credit|balance|cap|£/i, `"${m}" leaks the customer's billing state`);
  }
  assert.match(capMessage('ip_throttle'), /wait a few minutes/i);
});
