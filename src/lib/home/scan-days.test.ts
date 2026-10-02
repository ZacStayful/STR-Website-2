import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecount, memberScanTotal, newSinceJoining, recountScanDays, scanDaysToRecount, type ScanScope, type ScreenedListing } from './scan-days.ts';

/** How every job writes sourced_listings: insert, ignoring a URL already there (first_seen_at never moves). */
function screen(store: Map<string, ScreenedListing>, url: string, at: string, area: string, kind: string) {
  if (!store.has(url)) store.set(url, { url, firstSeenAt: new Date(at), area, kind });
}

const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30'];

test('a listing re-screened on 3 days counts once, on the day it was first screened', () => {
  const store = new Map<string, ScreenedListing>();
  screen(store, 'a', '2026-09-28T08:00:00Z', 'LS', 'sale');
  screen(store, 'a', '2026-09-29T08:00:00Z', 'LS', 'sale');
  screen(store, 'a', '2026-09-30T08:00:00Z', 'LS', 'sale');
  screen(store, 'b', '2026-09-29T08:00:00Z', 'ls', 'rent');
  const rows = recountScanDays([...store.values()], DAYS);
  assert.equal(rows.reduce((n, r) => n + r.newListings, 0), 2);
  assert.deepEqual(rows.find((r) => r.kind === 'sale'), { day: '2026-09-28', area: 'LS', kind: 'sale', newListings: 1 });
  assert.equal(rows.find((r) => r.kind === 'rent')?.area, 'LS', 'areas are upper-cased');
});

test('re-running a job does not double a day: a recount replaces the day', () => {
  const store = new Map<string, ScreenedListing>();
  screen(store, 'a', '2026-09-29T08:00:00Z', 'LS', 'sale');
  screen(store, 'b', '2026-09-29T09:00:00Z', 'LS', 'sale');
  let table = applyRecount([], DAYS, recountScanDays([...store.values()], DAYS));
  table = applyRecount(table, ['2026-09-29'], recountScanDays([...store.values()], ['2026-09-29']));
  table = applyRecount(table, ['2026-09-29'], recountScanDays([...store.values()], ['2026-09-29']));
  assert.equal(table.reduce((n, r) => n + r.newListings, 0), 2);
  // A later listing on the same day raises the count to the true figure, not by a re-added amount.
  screen(store, 'c', '2026-09-29T20:00:00Z', 'LS', 'sale');
  table = applyRecount(table, ['2026-09-29'], recountScanDays([...store.values()], ['2026-09-29']));
  assert.equal(table.reduce((n, r) => n + r.newListings, 0), 3);
});

test('a UK day: 23:30 BST is still that day; jobs recount yesterday and today', () => {
  const rows = recountScanDays([{ url: 'x', firstSeenAt: new Date('2026-09-29T22:30:00Z'), area: 'M', kind: 'sale' }], DAYS);
  assert.equal(rows[0].day, '2026-09-29');
  assert.deepEqual(scanDaysToRecount(new Date('2026-10-02T06:00:00Z')), ['2026-10-01', '2026-10-02']);
  assert.deepEqual(scanDaysToRecount(new Date('2026-10-02T23:30:00Z')), ['2026-10-02', '2026-10-03'], '00:30 BST is the next UK day');
});

test('a member: new listings in scope after the joining day, plus the baseline (or the reveal, whichever is more)', () => {
  const table = [
    { day: '2026-09-28', area: 'LS', kind: 'sale' as const, newListings: 5 },
    { day: '2026-09-29', area: 'LS', kind: 'sale' as const, newListings: 3 },
    { day: '2026-09-29', area: 'M', kind: 'rent' as const, newListings: 4 },
  ];
  const everywhere: ScanScope = { areas: null, kinds: new Set(['sale', 'rent']) };
  const leedsSales: ScanScope = { areas: new Set(['LS']), kinds: new Set(['sale']) };
  assert.equal(newSinceJoining(table, everywhere, '2026-09-28'), 7, 'the joining day itself is in the baseline, not new');
  assert.equal(newSinceJoining(table, leedsSales, '2026-09-28'), 3);
  assert.equal(newSinceJoining(table, everywhere, '2026-09-29'), 0);
  assert.deepEqual(memberScanTotal(1077, null, 5750), { baseline: 1077, newSince: 5750, total: 6827 });
  assert.deepEqual(memberScanTotal(3022, 403, 0), { baseline: 3022, newSince: 0, total: 3022 }, 'the reveal is inside the baseline');
  assert.deepEqual(memberScanTotal(0, 403, 0), { baseline: 403, newSince: 0, total: 403 });
  assert.deepEqual(memberScanTotal(null, undefined, Number.NaN), { baseline: 0, newSince: 0, total: 0 });
});
