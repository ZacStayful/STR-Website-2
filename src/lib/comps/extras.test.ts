import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compHistoryExtras } from './extras.ts';
import { latestCompleteMonth, monthKey } from './months.ts';
import { manchesterComps } from './__fixtures__/report-comps.ts';

test('end to end on a Manchester-shaped report', () => {
  const comps = manchesterComps();
  const anchor = latestCompleteMonth(comps.map((c) => c.revenue_ltm_monthly), new Date('2026-09-24T12:00:00Z'));
  assert.equal(monthKey(anchor!), '2026-08');
  const displayed = comps.slice(0, 12).map((c) => ({ ...c, scale: 1.05 }));
  const displayedRevenues = displayed.map((_, k) => 20000 + k * 1500);
  const x = compHistoryExtras({ anchor, similar: comps, displayed, displayedRevenues });
  assert.equal(x.earningsRange!.annual!.n, 12);
  assert.equal(x.earningsRange!.monthly!.to, '2026-08');
  assert.ok(x.earningsRange!.monthly!.n.every((n) => n === 12));
  assert.equal(x.localTrend!.direction, 'up');
  assert.equal(x.stayProfile!.basis, 'established');
  assert.equal(x.stayProfile!.to, '2026-08');
});

test('nothing to work with gives nulls', () => {
  assert.deepEqual(compHistoryExtras({ anchor: null, similar: [], displayed: [], displayedRevenues: [] }), {
    earningsRange: null,
    localTrend: null,
    stayProfile: null,
  });
});
