import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcReport, median } from './report.ts';
import { DEFAULT_FUNNEL_TIERS } from '../funnels/tiers.ts';

test('the funnel, the median and revenue by tier', () => {
  const r = mcReport({
    views: [{ views: 100, tagged: 80 }, { views: 50, tagged: 10 }],
    accounts: [
      { id: 'a', email: 'a@x', createdAt: '2026-10-02T10:00:00Z', stampedAt: '2026-10-02T10:00:00Z', via: 'first_touch', packPaid: true, firstLiveAt: '2026-10-02T10:04:00Z', chargedLeads: 3 },
      { id: 'b', email: 'b@x', createdAt: '2026-10-02T11:00:00Z', stampedAt: '2026-10-02T11:00:00Z', via: 'start', packPaid: true, firstLiveAt: '2026-10-02T11:10:00Z', chargedLeads: 0 },
      { id: 'c', email: 'c@x', createdAt: '2026-10-02T12:00:00Z', stampedAt: '2026-10-02T12:00:00Z', via: 'first_touch', packPaid: false, firstLiveAt: null, chargedLeads: 0 },
    ],
    charges: [
      { month: '2026-10-01', n: 1, basePence: 500 },
      { month: '2026-10-01', n: 21, basePence: 400 },
      { month: '2026-09-01', n: 151, basePence: 250 },
    ],
    tiers: [...DEFAULT_FUNNEL_TIERS],
  });
  assert.equal(r.pageViews, 150);
  assert.equal(r.taggedViews, 90);
  assert.deepEqual([r.signups, r.paid, r.live, r.firstLead], [3, 2, 2, 1]);
  assert.equal(r.medianMinutesToLive, 7);
  assert.deepEqual(r.byVia, { first_touch: 2, start: 1 });
  assert.deepEqual(r.leadsByMonth, [{ month: '2026-10-01', leads: 2, pence: 900 }, { month: '2026-09-01', leads: 1, pence: 250 }]);
  assert.deepEqual(r.revenueByTier.map((t) => [t.from, t.leads, t.pence]), [[1, 1, 500], [21, 1, 400], [61, 0, 0], [151, 1, 250]]);
});

test('median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
