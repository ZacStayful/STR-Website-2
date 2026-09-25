import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIntervalMs, nextCheckDueAt, retirementFor, dueTier, orderDueQueue, RENT_CHECK_MS, SALE_CHECK_MS, TOP_BAND_CHECK_MS, type DueRow } from './cadence.ts';

const NOW = new Date('2026-09-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

test('check interval: rentals 2 days, sales 7 days, top bands daily', () => {
  assert.equal(checkIntervalMs('rent', 10_000), RENT_CHECK_MS);
  assert.equal(checkIntervalMs('sale', 10_000), SALE_CHECK_MS);
  assert.equal(checkIntervalMs('sale', 40_000), TOP_BAND_CHECK_MS);
  assert.equal(checkIntervalMs('rent', 65_000), TOP_BAND_CHECK_MS);
  assert.equal(checkIntervalMs('sale', null), SALE_CHECK_MS);
  assert.equal(nextCheckDueAt('rent', 8_000, NOW), new Date(NOW.getTime() + 2 * DAY).toISOString());
});

test('retirement without a fetch: 90 days listed, or 21 days unconfirmed', () => {
  assert.equal(retirementFor({ listed_date: ago(89 * DAY), first_seen_at: ago(89 * DAY), last_confirmed_at: ago(1 * DAY) }, NOW), null);
  assert.equal(retirementFor({ listed_date: ago(91 * DAY), first_seen_at: ago(5 * DAY), last_confirmed_at: ago(1 * DAY) }, NOW), 'stale_listed', 'the portal date wins over our sighting');
  assert.equal(retirementFor({ listed_date: null, first_seen_at: ago(91 * DAY), last_confirmed_at: ago(1 * DAY) }, NOW), 'stale_listed', 'first sighting is the floor');
  assert.equal(retirementFor({ listed_date: null, first_seen_at: ago(30 * DAY), last_confirmed_at: ago(22 * DAY) }, NOW), 'stale_unseen');
  assert.equal(retirementFor({ listed_date: null, first_seen_at: ago(30 * DAY), last_confirmed_at: ago(20 * DAY) }, NOW), null);
  assert.equal(retirementFor({ listed_date: 'not a date', first_seen_at: ago(10 * DAY), last_confirmed_at: ago(1 * DAY) }, NOW), null, 'a bad portal date falls back to the sighting');
});

const row = (over: Partial<DueRow>): DueRow => ({
  canonical_url: `https://x/${Math.random()}`,
  source: 'rightmove',
  kind: 'sale',
  status: 'live',
  annual_profit: 10_000,
  last_checked_live_at: ago(10 * DAY),
  last_confirmed_at: ago(3 * DAY),
  next_check_due_at: ago(1 * HOUR),
  check_requested_at: null,
  last_shown_at: null,
  ...over,
});

test('due tiers: entry, requested, shown, rentals, top bands, tail, not due', () => {
  assert.equal(dueTier(row({ status: 'pending_verify' }), NOW), 0);
  assert.equal(dueTier(row({ check_requested_at: ago(HOUR) }), NOW), 1);
  assert.equal(dueTier(row({ last_shown_at: ago(2 * HOUR), last_checked_live_at: ago(3 * DAY) }), NOW), 2);
  assert.equal(dueTier(row({ last_shown_at: ago(2 * HOUR), last_checked_live_at: ago(HOUR) }), NOW), 5, 'shown but checked an hour ago is just the tail');
  assert.equal(dueTier(row({ kind: 'rent' }), NOW), 3);
  assert.equal(dueTier(row({ annual_profit: 45_000 }), NOW), 4);
  assert.equal(dueTier(row({}), NOW), 5);
  assert.equal(dueTier(row({ next_check_due_at: new Date(NOW.getTime() + HOUR).toISOString() }), NOW), 6);
  assert.equal(dueTier(row({ next_check_due_at: null }), NOW), 5, 'never scheduled counts as due');
});

test('orderDueQueue sorts by tier then oldest confirmation, caps per portal, skips other sources', () => {
  const rows = [
    row({ canonical_url: 'tail-new', last_confirmed_at: ago(1 * DAY) }),
    row({ canonical_url: 'tail-old', last_confirmed_at: ago(6 * DAY) }),
    row({ canonical_url: 'rent', kind: 'rent' }),
    row({ canonical_url: 'entry', status: 'pending_verify' }),
    row({ canonical_url: 'zoopla', source: 'zoopla', status: 'pending_verify' }),
    row({ canonical_url: 'not-due', next_check_due_at: new Date(NOW.getTime() + DAY).toISOString() }),
  ];
  assert.deepEqual(orderDueQueue(rows, NOW).map((r) => r.canonical_url), ['entry', 'rent', 'tail-old', 'tail-new']);
  const capped = orderDueQueue(rows, NOW, { rightmove: 2 });
  assert.deepEqual(capped.map((r) => r.canonical_url), ['entry', 'rent']);
  const many = Array.from({ length: 100 }, (_, i) => row({ canonical_url: `rm${i}` })).concat(Array.from({ length: 100 }, (_, i) => row({ canonical_url: `otm${i}`, source: 'onthemarket' })));
  const out = orderDueQueue(many, NOW);
  assert.equal(out.filter((r) => r.source === 'rightmove').length, 30);
  assert.equal(out.filter((r) => r.source === 'onthemarket').length, 60);
});
