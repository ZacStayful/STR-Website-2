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
    canonical_url: 'https://www.rightmove.co.uk/properties/1',
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
