import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertIdsOf, settleChanges, type AlertRow, type CurrentState } from './alerts.ts';

const NOW = new Date('2026-09-28T07:00:00Z');
const U = 'u1';

function row(over: Partial<AlertRow> & { payload?: AlertRow['payload'] }): AlertRow {
  return {
    id: 'a',
    user_id: U,
    alert_type: 'price_drop',
    source: 'marketplace',
    deal_key: 'd-d1',
    deal_id: 'd1',
    checked_listing_id: null,
    event_at: '2026-09-27T06:00:00Z',
    created_at: '2026-09-27T06:55:00Z',
    payload: { kind: 'sale', stage: 'watching', oldAmount: 250_000, newAmount: 240_000, period: 'total', figure: '+44% · £8,900/yr over a long let' },
    ...over,
  };
}

const state = (over: Partial<CurrentState> = {}): CurrentState => ({
  deals: new Map([['d1', { status: 'live', priceAmount: 240_000, pricePeriod: 'total' }]]),
  rows: new Map(),
  passed: new Set(),
  ...over,
});

test('a single drop is told as stored', () => {
  const s = settleChanges([row({})], state(), NOW);
  assert.equal(s.changes.length, 1);
  assert.equal(s.changes[0].oldAmount, 250_000);
  assert.equal(s.changes[0].newAmount, 240_000);
  assert.equal(s.changes[0].figure, '+44% · £8,900/yr over a long let');
});

test('consecutive drops collapse to first price → price now, and every id is marked', () => {
  const rows = [row({ id: 'a1' }), row({ id: 'a2', event_at: '2026-09-28T06:00:00Z', payload: { kind: 'sale', stage: 'watching', oldAmount: 240_000, newAmount: 230_000, period: 'total', figure: '+50%' } })];
  const s = settleChanges(rows, state({ deals: new Map([['d1', { status: 'live', priceAmount: 230_000, pricePeriod: 'total' }]]) }), NOW);
  assert.equal(s.changes.length, 1);
  assert.equal(s.changes[0].oldAmount, 250_000);
  assert.equal(s.changes[0].newAmount, 230_000);
  assert.equal(s.changes[0].figure, '+50%');
  assert.deepEqual(alertIdsOf(s.changes).sort(), ['a1', 'a2']);
});

test('a drop that has since gone back up is not told, and its figure is never reused', () => {
  const up = settleChanges([row({})], state({ deals: new Map([['d1', { status: 'live', priceAmount: 255_000, pricePeriod: 'total' }]]) }), NOW);
  assert.equal(up.changes.length, 0);
  assert.deepEqual(up.dismissed, ['a']);
  // Lower than the start but not the stored price: told at today's price, without the stale figure.
  const partly = settleChanges([row({})], state({ deals: new Map([['d1', { status: 'live', priceAmount: 245_000, pricePeriod: 'total' }]]) }), NOW);
  assert.equal(partly.changes[0].newAmount, 245_000);
  assert.equal(partly.changes[0].figure, null);
});

test('Passed and Secured never alert; a Pass on the grid counts', () => {
  assert.equal(settleChanges([row({ payload: { kind: 'sale', stage: 'passed', oldAmount: 2, newAmount: 1, period: 'total' } })], state(), NOW).changes.length, 0);
  assert.equal(settleChanges([row({ payload: { kind: 'sale', stage: 'secured', oldAmount: 2, newAmount: 1, period: 'total' } })], state(), NOW).changes.length, 0);
  assert.equal(settleChanges([row({})], state({ passed: new Set([`${U}:d1`]) }), NOW).changes.length, 0);
  // The row's stage NOW beats what was stored when the alert was made.
  const moved = settleChanges([row({ checked_listing_id: 'r1' })], state({ rows: new Map([['r1', { stage: 'passed', listingStatus: 'available' }]]) }), NOW);
  assert.equal(moved.changes.length, 0);
});

test('a price drop on a deal that has since gone is not told; the gone is', () => {
  const rows = [row({ id: 'drop' }), row({ id: 'gone', alert_type: 'gone', event_at: '2026-09-28T05:00:00Z', payload: { kind: 'sale', stage: 'watching', status: 'under_offer' } })];
  const s = settleChanges(rows, state({ deals: new Map([['d1', { status: 'retired', priceAmount: 240_000, pricePeriod: 'total' }]]) }), NOW);
  assert.deepEqual(s.changes.map((c) => c.alertType), ['gone']);
  assert.ok(s.dismissed.includes('drop'));
});

test('of gone and back on the market, only the latest is told, and back needs it live', () => {
  const gone = row({ id: 'g', alert_type: 'gone', event_at: '2026-09-20T05:00:00Z', payload: { kind: 'sale', status: 'under_offer' } });
  const back = row({ id: 'b', alert_type: 'back_on_market', event_at: '2026-09-27T05:00:00Z', payload: { kind: 'sale', previousStatus: 'under_offer' } });
  const s = settleChanges([gone, back], state(), NOW);
  assert.deepEqual(s.changes.map((c) => c.id), ['b']);
  assert.ok(s.dismissed.includes('g'));
  const notLive = settleChanges([back], state({ deals: new Map([['d1', { status: 'pending_verify', priceAmount: null, pricePeriod: null }]]) }), NOW);
  assert.equal(notLive.changes.length, 0);
});

test('one stream per deal: a pipeline row and a kept deal on the same listing are told once', () => {
  const kept = row({ id: 'k' });
  const pipe = row({ id: 'p', source: 'pipeline', deal_id: null, checked_listing_id: 'r1', event_at: '2026-09-27T06:00:00Z' });
  const s = settleChanges([kept, pipe], state({ rows: new Map([['r1', { stage: 'watching', listingStatus: 'available' }]]) }), NOW);
  assert.equal(s.changes.length, 1);
  assert.deepEqual(alertIdsOf(s.changes).sort(), ['k', 'p']);
});

test('old alerts expire rather than flood', () => {
  const s = settleChanges([row({ created_at: '2026-09-10T06:55:00Z' })], state(), NOW);
  assert.equal(s.changes.length, 0);
  assert.deepEqual(s.dismissed, ['a']);
});

test('the address never survives unless the deal was opened', () => {
  const s = settleChanges([row({ payload: { kind: 'sale', opened: false, address: '1 Secret Rd', oldAmount: 2, newAmount: 1, period: 'total' } })], state({ deals: new Map() }), NOW);
  assert.equal(s.changes[0].address, null);
  const o = settleChanges([row({ payload: { kind: 'sale', opened: true, address: '1 Open Rd', oldAmount: 2, newAmount: 1, period: 'total' } })], state({ deals: new Map() }), NOW);
  assert.equal(o.changes[0].address, '1 Open Rd');
});

// ── Collecting ──

import { alertsFor, type TrackedForAlerts, type AlertedBefore } from './alerts.ts';

const none: AlertedBefore = { lowestDrop: new Map(), lastBack: new Map() };
const h = (over: Record<string, unknown>) => ({ at: '2026-09-27T06:00:00Z', amount: null as number | null, period: 'total', status: null as string | null, previousAmount: null as number | null, previousStatus: null as string | null, notified: false, ...over }) as import('../listing/recheck.ts').PriceHistoryEntry;

function tracked(over: Partial<TrackedForAlerts> = {}): TrackedForAlerts {
  return {
    key: 'd-d1',
    stage: 'watching',
    kind: 'sale',
    opened: false,
    address: '1 Secret Road',
    town: 'York',
    type: '3 bed terraced',
    dealId: 'd1',
    checkedListingId: null,
    trackedSince: '2026-09-20T00:00:00Z',
    pipelineHistory: null,
    pipelineDeal: null,
    deal: { status: 'live', priceAmount: 240_000, pricePeriod: 'total', figure: '+44% · £8,900/yr over a long let', liveSince: '2026-09-10T00:00:00Z', retiredReason: null, retiredAt: null, history: [h({ amount: 240_000, previousAmount: 250_000 })], revivedAt: null, revivedFrom: null },
    ...over,
  };
}

test('a recorded drop becomes one alert, with the figure only when it was computed at that price', () => {
  const [a] = alertsFor(U, [tracked()], new Map(), none, NOW);
  assert.equal(a.alert_type, 'price_drop');
  assert.equal(a.deal_key, 'd-d1');
  assert.equal(a.payload.oldAmount, 250_000);
  assert.equal(a.payload.figure, '+44% · £8,900/yr over a long let');
  // Unopened: the address is never stored.
  assert.equal(a.payload.address, null);
  const moved = alertsFor(U, [tracked({ deal: { ...tracked().deal!, priceAmount: 235_000 } })], new Map(), none, NOW);
  assert.equal(moved[0].payload.figure, null);
});

test('nothing before tracking began, nothing on Passed or Secured, nothing that is a relabel', () => {
  assert.equal(alertsFor(U, [tracked({ trackedSince: '2026-09-28T00:00:00Z' })], new Map(), none, NOW).length, 0);
  assert.equal(alertsFor(U, [tracked({ stage: 'passed' })], new Map(), none, NOW).length, 0);
  assert.equal(alertsFor(U, [tracked({ stage: 'secured' })], new Map(), none, NOW).length, 0);
  const relabel = tracked({ dealId: null, key: 'l-r1', checkedListingId: 'r1', deal: null, kind: 'rent', pipelineHistory: [h({ amount: 300, previousAmount: 1_300, period: 'pw' })] });
  assert.equal(alertsFor(U, [relabel], new Map(), none, NOW).length, 0);
});

test('a flip-flopping price alerts only when it goes below anything already alerted', () => {
  const deal = { ...tracked().deal!, history: [h({ at: '2026-09-25T06:00:00Z', amount: 240_000, previousAmount: 250_000 }), h({ at: '2026-09-26T06:00:00Z', amount: 250_000, previousAmount: 240_000 }), h({ at: '2026-09-27T06:00:00Z', amount: 240_000, previousAmount: 250_000 })] };
  const alerts = alertsFor(U, [tracked({ deal })], new Map(), none, NOW);
  assert.deepEqual(alerts.map((a) => a.event_at), ['2026-09-25T06:00:00Z']);
  // A drop to a price already alerted on a previous day is not new.
  assert.equal(alertsFor(U, [tracked()], new Map(), { lowestDrop: new Map([['d-d1', 240_000]]), lastBack: new Map() }, NOW).length, 0);
});

test('a pipeline row alerts from its own history, with its own figure only at that price', () => {
  const row = tracked({ key: 'l-r1', dealId: null, checkedListingId: 'r1', deal: null, opened: true, pipelineHistory: [h({ amount: 190_000, previousAmount: 200_000 })], pipelineDeal: { kind: 'purchase', askingPrice: 190_000, grossYieldPct: 8.14 } });
  const [a] = alertsFor(U, [row], new Map(), none, NOW);
  assert.equal(a.source, 'pipeline');
  assert.equal(a.payload.figure, '8.1% gross yield');
  assert.equal(a.payload.address, '1 Secret Road');
  const stale = alertsFor(U, [{ ...row, pipelineDeal: { kind: 'purchase', askingPrice: 200_000, grossYieldPct: 7.7 } }], new Map(), none, NOW);
  assert.equal(stale[0].payload.figure, null);
});

test('gone, and back on the market only once a page read confirmed it, once a fortnight', () => {
  const gone = alertsFor(U, [tracked({ deal: { ...tracked().deal!, history: [], status: 'retired', retiredReason: 'under_offer', retiredAt: '2026-09-27T09:00:00Z' } })], new Map(), none, NOW);
  assert.deepEqual(gone.map((a) => [a.alert_type, a.payload.status]), [['gone', 'under_offer']]);
  const revived = { ...tracked().deal!, history: [], revivedAt: '2026-09-27T05:10:00Z', revivedFrom: 'under_offer' };
  // Revived on the feed but not yet confirmed by a page read: nothing yet.
  assert.equal(alertsFor(U, [tracked({ deal: { ...revived, status: 'pending_verify' } })], new Map(), none, NOW).length, 0);
  assert.equal(alertsFor(U, [tracked({ deal: { ...revived, liveSince: '2026-09-10T00:00:00Z' } })], new Map(), none, NOW).length, 0);
  const back = alertsFor(U, [tracked({ deal: { ...revived, liveSince: '2026-09-27T06:30:00Z' } })], new Map(), none, NOW);
  assert.deepEqual(back.map((a) => a.alert_type), ['back_on_market']);
  // Revivals from an unqualified / stale retirement are not "back on the market".
  assert.equal(alertsFor(U, [tracked({ deal: { ...revived, revivedFrom: 'stale_unseen', liveSince: '2026-09-27T06:30:00Z' } })], new Map(), none, NOW).length, 0);
  const soon = alertsFor(U, [tracked({ deal: { ...revived, liveSince: '2026-09-27T06:30:00Z' } })], new Map(), { lowestDrop: new Map(), lastBack: new Map([['d-d1', Date.parse('2026-09-20T00:00:00Z')]]) }, NOW);
  assert.equal(soon.length, 0);
});

test('getting attention needs 3 other accounts and a live deal, and is once per time live', () => {
  const quiet = { ...tracked().deal!, history: [] };
  assert.equal(alertsFor(U, [tracked({ deal: quiet })], new Map([['d1', 2]]), none, NOW).length, 0);
  const [a] = alertsFor(U, [tracked({ deal: quiet })], new Map([['d1', 3]]), none, NOW);
  assert.equal(a.alert_type, 'nearly_gone');
  assert.equal(a.event_at, '2026-09-10T00:00:00Z');
  assert.equal(a.payload.watchers, 3);
  assert.equal(alertsFor(U, [tracked({ deal: { ...quiet, status: 'retired' } })], new Map([['d1', 5]]), none, NOW).filter((x) => x.alert_type === 'nearly_gone').length, 0);
});

test('a change the old re-check already emailed is never alerted again', () => {
  const row = tracked({ key: 'l-r1', dealId: null, checkedListingId: 'r1', deal: null, pipelineHistory: [h({ amount: 190_000, previousAmount: 200_000, notified: true }), h({ at: '2026-09-27T07:00:00Z', status: 'under_offer', previousStatus: 'available', notified: true })] });
  assert.equal(alertsFor(U, [row], new Map(), none, NOW).length, 0);
});

test('a listing that keeps flipping gone is told gone once, until it has come back', () => {
  const again = tracked({ deal: { ...tracked().deal!, history: [], status: 'retired', retiredReason: 'under_offer', retiredAt: '2026-09-27T09:00:00Z' } });
  const toldBefore = { lowestDrop: new Map(), lastBack: new Map(), lastGone: new Map([['d-d1', { at: Date.parse('2026-09-26T09:00:00Z'), status: 'under_offer' }]]) };
  assert.equal(alertsFor(U, [again], new Map(), toldBefore, NOW).length, 0);
  // Told it came back since then: going again is news.
  const backSince = { ...toldBefore, lastBack: new Map([['d-d1', Date.parse('2026-09-26T20:00:00Z')]]) };
  assert.deepEqual(alertsFor(U, [again], new Map(), backSince, NOW).map((a) => a.alert_type), ['gone']);
  // A different status is news too.
  const sold = tracked({ deal: { ...again.deal!, retiredReason: 'sold' } });
  assert.deepEqual(alertsFor(U, [sold], new Map(), toldBefore, NOW).map((a) => a.payload.status), ['sold']);
});
