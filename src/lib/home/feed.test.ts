import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, dayLabel, feedFrom } from './feed.ts';

const now = new Date('2026-10-02T12:00:00Z');

test('this week: one line a day that had anything, newest first, capped', () => {
  const items = buildFeed(
    [
      { day: '2026-10-02', screened: 1079, picked: 5, emailed: 4 },
      { day: '2026-10-01', screened: 1, picked: 0, emailed: 0 },
      { day: '2026-09-30', screened: 0, picked: 0, emailed: 0 },
    ],
    [{ at: '2026-10-01T09:00:00Z', kind: 'price_drop', area: 'LS', areaName: 'Leeds', dealId: 'd1' }],
    now,
  );
  assert.equal(items.length, 3);
  assert.equal(items[0].text, 'Today: Screened 1,079 new listings in your areas, picked 5 deals for you, emailed you 4 deals');
  assert.equal(items[0].href, '/today');
  assert.equal(items[1].text, 'Yesterday: Screened 1 new listing in your areas');
  assert.equal(items[2].text, "Yesterday: Spotted a price drop on a deal you're tracking in Leeds (LS)");
  assert.equal(items[2].href, '/deals/d1');
  const many = buildFeed([], Array.from({ length: 20 }, (_, i) => ({ at: `2026-10-0${1 + (i % 2)}T0${i % 9}:00:00Z`, kind: 'analysis' as const, area: null, areaName: null, dealId: null })), now);
  assert.equal(many.length, 8);
});

test('this week never names an address', () => {
  const items = buildFeed([], [{ at: '2026-10-01T09:00:00Z', kind: 'gone', area: 'M', areaName: 'M postcode area', dealId: 'd' }], now);
  assert.equal(items[0].text, "Yesterday: Let you know a deal you're tracking in M has gone");
});

test('the week starts six UK days back; days are named', () => {
  assert.equal(feedFrom(now), '2026-09-26');
  assert.equal(dayLabel('2026-10-02', '2026-10-02'), 'Today');
  assert.equal(dayLabel('2026-09-29', '2026-10-02'), 'Tue 29 Sept');
});
