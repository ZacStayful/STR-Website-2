import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movesByTarget, RESTREAM_STATUSES, restreamPlan, tallyLine, targetStream, type RestreamRow } from './restream.ts';
import { DEFAULT_LOW_ENTRY } from './config.ts';

const row = (id: string, over: Partial<RestreamRow> = {}): RestreamRow => ({
  id,
  kind: 'sale',
  status: 'live',
  stream: 'top60',
  deal: { kind: 'purchase', askingPrice: 250_000, cashRequired: 84_000 },
  postcode_area: 'CA',
  bedrooms: 2,
  price_amount: 250_000,
  ...over,
});

test('Batch 22c: every deal still in play is re-streamed on its price; a Project deal keeps its stream', () => {
  assert.deepEqual([...RESTREAM_STATUSES], ['live', 'pending_check', 'pending_verify']);
  const rows: RestreamRow[] = [
    row('a', { deal: { kind: 'purchase', askingPrice: 140_000, cashRequired: 60_000 }, price_amount: 140_000 }), // top60 → low_entry
    row('b', { stream: 'low_entry', deal: { kind: 'purchase', askingPrice: 260_000, cashRequired: 45_000 } }), // low_entry → top60 (a small cash in is no longer enough)
    row('c'), // stays top60
    row('d', { stream: 'project', deal: { kind: 'purchase', askingPrice: 90_000, cashRequired: 30_000 } }), // Project keeps its stream
    row('e', { kind: 'rent', stream: null, deal: null, price_amount: 900 }), // none → r2r
    row('f', { status: 'pending_check', stream: 'top60', deal: { kind: 'purchase', askingPrice: 150_000, cashRequired: 58_000 } }), // waiting: top60 → low_entry
  ];
  const plan = restreamPlan(rows, DEFAULT_LOW_ENTRY);
  assert.equal(plan.rows, 6);
  assert.deepEqual(plan.moves.map((m) => `${m.id}:${m.from}→${m.to}`), ['a:top60→low_entry', 'b:low_entry→top60', 'e:null→r2r', 'f:top60→low_entry']);
  assert.deepEqual(plan.before.live, { top60: 2, low_entry: 1, r2r: 0, project: 1, none: 1 });
  assert.deepEqual(plan.after.live, { top60: 2, low_entry: 1, r2r: 1, project: 1, none: 0 });
  assert.deepEqual(plan.after.all, { top60: 2, low_entry: 2, r2r: 1, project: 1, none: 0 });
  assert.deepEqual(movesByTarget(plan.moves), { low_entry: ['a', 'f'], top60: ['b'], r2r: ['e'] });
  assert.equal(targetStream({ kind: 'sale', stream: 'project', deal: null }, DEFAULT_LOW_ENTRY), 'project');
});

test('the report never carries an address or a URL: an id, the area, bedrooms and price', () => {
  const plan = restreamPlan([row('a', { deal: { kind: 'purchase', askingPrice: 100_000 }, price_amount: '100000' })], DEFAULT_LOW_ENTRY);
  assert.deepEqual(Object.keys(plan.moves[0]).sort(), ['area', 'bedrooms', 'from', 'id', 'price', 'status', 'to']);
  assert.equal(plan.moves[0].price, 100_000);
});

test('idempotent: once the column matches, nothing moves', () => {
  const rows = [row('a', { stream: 'low_entry', deal: { kind: 'purchase', askingPrice: 140_000 } }), row('b')];
  assert.equal(restreamPlan(rows, DEFAULT_LOW_ENTRY).moves.length, 0);
});

test('one line per tally for the admin box', () => {
  const plan = restreamPlan([row('a', { deal: { kind: 'purchase', askingPrice: 140_000 } }), row('b')], DEFAULT_LOW_ENTRY);
  assert.equal(tallyLine(plan.before.live, plan.after.live), 'top60 2 → 1 · low_entry 0 → 1');
});
