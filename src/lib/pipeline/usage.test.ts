import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseUsage, usageTotals, type StepEventRow } from './usage.ts';

const row = (user: string, stage: string, action: string, item: string | null, kind = 'purchase'): StepEventRow => ({ user_id: user, stage, deal_kind: kind, action, item_id: item });

test('each tool at each stage: uses and distinct members, in stage order', () => {
  const rows = [
    row('a', 'viewing', 'tick', 'parking'),
    row('a', 'viewing', 'tick', 'parking'),
    row('b', 'viewing', 'tick', 'parking'),
    row('a', 'watching', 'copy', 'kept-purchase-enquiry'),
    row('b', 'watching', 'advance', 'contacted'),
    row('c', 'secured', 'enquiry', null, 'rent-to-rent'),
  ];
  const out = summariseUsage(rows);
  assert.deepEqual(out.map((r) => [r.stageLabel, r.label, r.uses, r.members]), [
    ['Kept', 'Copied Contact the agent: message', 1, 1],
    ['Kept', 'Moved on to Contacted agent / landlord', 1, 1],
    ['Viewing booked', 'Ticked Parking', 3, 2],
    ['Secured', 'Sent a management enquiry', 1, 1],
  ]);
});

test('unknown ids and actions still show, as they are', () => {
  const out = summariseUsage([row('a', 'odd', 'mystery', 'gone-item')]);
  assert.equal(out[0].label, 'mystery gone-item');
  assert.equal(out[0].stageLabel, 'odd');
});

test('totals', () => {
  const t = usageTotals([row('a', 'viewing', 'tick', 'x'), row('b', 'viewing', 'tick', 'x'), row('a', 'watching', 'copy', 'y')]);
  assert.deepEqual(t, { members: 2, byAction: { tick: 2, copy: 1 } });
});
