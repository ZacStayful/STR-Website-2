import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageBreakdown, percentages, categorise, type LedgerLine } from './usage-breakdown.ts';

const line = (over: Partial<LedgerLine>): LedgerLine => ({ kind: 'debit', action: null, provider: null, unit: null, actionId: null, facePence: 0, metadata: null, ...over });

test('percentages always add up to 100', () => {
  assert.deepEqual(percentages([1, 1, 1]), [34, 33, 33]);
  assert.equal(percentages([990, 400, 60, 200, 3]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(percentages([0, 0]), [0, 0]);
  assert.deepEqual(percentages([5, -2, Number.NaN]), [100, 0, 0]);
});

test('each kind of spend lands in its own category', () => {
  const lines = [
    line({ action: 'todays_5', facePence: 33 }),
    line({ action: 'cron:sourcing', facePence: 60 }),
    line({ action: 'full_analysis', facePence: 400, metadata: { open_action_id: 'open-1' } }),
    line({ action: 'deal_open', actionId: 'open-1', facePence: 60 }),
    line({ action: 'deal_open', actionId: 'open-2', facePence: 40 }),
    line({ action: 'pmi_addon', facePence: 200 }),
    line({ action: 'report_enhanced', provider: 'pmi', unit: 'str_estimate', facePence: 375 }),
    line({ action: 'report_enhanced', provider: 'airbtics', facePence: 100 }),
    line({ action: 'team_seat', facePence: 1000 }),
    line({ action: 'report', provider: 'propertydata', facePence: 50, metadata: { funnel_id: 'f1' } }),
  ];
  const b = usageBreakdown(lines);
  const by = Object.fromEntries(b.rows.map((r) => [r.category, r.facePence]));
  assert.equal(by.daily, 93);
  // The one-tap's Quick look counts as the analysis; a Quick look on its own does not.
  assert.equal(by.full, 400 + 60 + 100);
  assert.equal(by.quick, 40);
  assert.equal(by.pmi, 575);
  // A funnel lead is never the member's own research.
  assert.equal(by.other, 1050);
  assert.equal(b.rows.reduce((a, r) => a + r.pct, 0), 100);
});

test('a refund comes off what it refunded', () => {
  const b = usageBreakdown([line({ action: 'report', provider: 'propertydata', facePence: 500 }), line({ kind: 'refund', action: 'report', provider: 'propertydata', facePence: 500 }), line({ action: 'deal_open', facePence: 60 })]);
  const by = Object.fromEntries(b.rows.map((r) => [r.category, r]));
  assert.equal(by.full.facePence, 0);
  assert.equal(by.quick.pct, 100);
  assert.equal(b.totalFacePence, 60);
});

test('nothing spent: nothing to split', () => {
  const b = usageBreakdown([]);
  assert.equal(b.totalFacePence, 0);
  assert.ok(b.rows.every((r) => r.pct === 0));
});

test('an unknown action is Other, never lost', () => {
  assert.equal(categorise(line({ action: 'narrate' }), new Set()), 'other');
  assert.equal(categorise(line({ action: null }), new Set()), 'other');
});
