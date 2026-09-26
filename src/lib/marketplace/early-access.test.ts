import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyAccessBanner, earlyAccessFor, earlyAccessHint, isFiltered } from './early-access.ts';
import { DEFAULT_FILTERS, parseDealFilters } from './grid.ts';
import { dealVisibility, dealVisible } from './visibility.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test('inside the window a deal has a free-at time; outside it has none', () => {
  assert.deepEqual(earlyAccessFor(hoursAgo(17), 48, NOW), { freeAt: new Date('2026-09-27T19:00:00Z') });
  assert.equal(earlyAccessFor(hoursAgo(48), 48, NOW), null);
  assert.equal(earlyAccessFor(hoursAgo(72), 48, NOW), null);
  assert.equal(earlyAccessFor(hoursAgo(1), 0, NOW), null, 'no delay configured, no early access');
  assert.equal(earlyAccessFor(hoursAgo(1), Number.NaN, NOW), null);
  // No live_since: brand new, exactly as Batch 1 hides it from free accounts.
  assert.deepEqual(earlyAccessFor(null, 48, NOW), { freeAt: new Date(NOW.getTime() + 48 * 3_600_000) });
  assert.deepEqual(earlyAccessFor('garbage', 48, NOW), { freeAt: new Date(NOW.getTime() + 48 * 3_600_000) });
});

test('the badge agrees with the rule that hides the deal from free accounts', () => {
  const free = dealVisibility('free', NOW, 48);
  for (const h of [0, 1, 17, 47, 47.9, 48, 49, 200]) {
    const since = hoursAgo(h);
    assert.equal(earlyAccessFor(since, 48, NOW) !== null, !dealVisible(since, free.cutoffIso), `${h}h in`);
  }
  assert.equal(earlyAccessFor(null, 48, NOW) !== null, !dealVisible(null, free.cutoffIso));
});

test('the hint counts whole hours up and never says 0h', () => {
  assert.equal(earlyAccessHint(new Date(NOW.getTime() + 31 * 3_600_000), NOW), 'Free members see this in 31h');
  assert.equal(earlyAccessHint(new Date(NOW.getTime() + 30.2 * 3_600_000), NOW), 'Free members see this in 31h');
  assert.equal(earlyAccessHint(new Date(NOW.getTime() + 60_000), NOW), 'Free members see this in 1h');
  assert.equal(earlyAccessHint(new Date(NOW.getTime() - 60_000), NOW), 'Free members see this in 1h');
});

test('the banner uses the real count, says when it is filtered, and hides at zero', () => {
  assert.equal(earlyAccessBanner(9, true), '9 new deals matching this search are in early access. Paid members are seeing them now.');
  assert.equal(earlyAccessBanner(29, false), '29 new deals are in early access. Paid members are seeing them now.');
  assert.equal(earlyAccessBanner(1, false), '1 new deal is in early access. Paid members are seeing it now.');
  assert.equal(earlyAccessBanner(1_204, false), '1,204 new deals are in early access. Paid members are seeing them now.');
  assert.equal(earlyAccessBanner(0, true), null);
  assert.equal(earlyAccessBanner(null, true), null);
  assert.equal(earlyAccessBanner(-3, false), null);
});

test('sort, page and the kept / passed view are not a search', () => {
  assert.equal(isFiltered(DEFAULT_FILTERS), false);
  assert.equal(isFiltered(parseDealFilters({ sort: 'newest', page: '3', view: 'kept' })), false);
  assert.equal(isFiltered(parseDealFilters({ areas: 'YO' })), true);
  assert.equal(isFiltered(parseDealFilters({ kind: 'rent' })), true);
  assert.equal(isFiltered(parseDealFilters({ minProfit: '10000' })), true);
});
