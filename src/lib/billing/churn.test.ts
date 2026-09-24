import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addMonths,
  bandFor,
  cyclesEndedSince,
  cyclesOnPlan,
  cyclesFromEvents,
  firstCycleMonth,
  monthlyPence,
  monthlyTrend,
  reasonsByBand,
  retentionByHorizon,
  planCodesIn,
  retentionByPlan,
  revenueByTenureBand,
  type SubEvent,
} from './churn.ts';

const NOW = new Date('2027-01-15T12:00:00.000Z');

function ev(partial: Partial<SubEvent> & Pick<SubEvent, 'userId' | 'at' | 'kind'>): SubEvent {
  return {
    cycleStartedAt: partial.cycleStartedAt ?? partial.at,
    planCode: 'pro',
    mrrPence: 3999,
    reason: null,
    reasonComment: null,
    source: 'stripe',
    ...partial,
  };
}

// ---------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------

test('addMonths counts calendar months and clamps a short month', () => {
  assert.equal(addMonths('2026-01-31T00:00:00.000Z', 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addMonths('2026-01-15T00:00:00.000Z', 12).toISOString().slice(0, 10), '2027-01-15');
  assert.equal(addMonths('2026-11-30T00:00:00.000Z', 3).toISOString().slice(0, 10), '2027-02-28');
});

test('monthlyPence divides an annual plan down', () => {
  assert.equal(monthlyPence({ pricePence: 36000, interval: 'year' }), 3000);
  assert.equal(monthlyPence({ pricePence: 3999, interval: 'month' }), 3999);
  assert.equal(monthlyPence({ pricePence: 0, interval: 'month' }), 0);
});

// ---------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------

test('a win-back is two cycles, not one long one', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-03-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'too_expensive' }),
      ev({ userId: 'u1', at: '2026-09-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-09-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  assert.equal(cycles.length, 2);
  assert.equal(cycles[0].endedAt, '2026-03-01T00:00:00.000Z');
  assert.equal(cycles[0].reason, 'too_expensive');
  assert.equal(cycles[1].endedAt, null);
  // The second spell must not inherit the first one's tenure.
  assert.equal(cycles[0].tenureDays, 59);
  assert.ok(cycles[1].tenureDays < 200);
});

test('a replayed end event does not move the end date', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-03-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-04-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].endedAt, '2026-03-01T00:00:00.000Z');
});

test('a duplicate cancel_scheduled keeps the earliest reason', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-02-01T00:00:00.000Z', kind: 'cancel_scheduled', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'not_using' }),
      ev({ userId: 'u1', at: '2026-02-02T00:00:00.000Z', kind: 'cancel_scheduled', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'other' }),
    ],
    NOW,
  );
  assert.equal(cycles[0].intentReason, 'not_using');
});

test('cancel_reverted clears the captured reason', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-02-01T00:00:00.000Z', kind: 'cancel_scheduled', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'too_expensive' }),
      ev({ userId: 'u1', at: '2026-02-10T00:00:00.000Z', kind: 'cancel_reverted', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  assert.equal(cycles[0].reason, null);
  assert.equal(cycles[0].intentReason, null);
  assert.equal(cycles[0].state, 'active');
});

test('past_due is at risk and recovered leaves it', () => {
  const base: SubEvent[] = [
    ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ev({ userId: 'u1', at: '2026-06-01T00:00:00.000Z', kind: 'past_due', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  assert.equal(cyclesFromEvents(base, NOW)[0].state, 'at_risk');
  assert.equal(cyclesFromEvents(base, NOW)[0].riskKind, 'past_due');

  const recovered = cyclesFromEvents(
    [...base, ev({ userId: 'u1', at: '2026-06-05T00:00:00.000Z', kind: 'recovered', cycleStartedAt: '2026-01-01T00:00:00.000Z' })],
    NOW,
  );
  assert.equal(recovered[0].state, 'active');
  assert.equal(recovered[0].riskKind, null);
});

test('a pause carries its reason onto the at-risk cycle', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-06-01T00:00:00.000Z', kind: 'paused', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'not_using', reasonComment: 'busy for a bit' }),
    ],
    NOW,
  );
  assert.equal(cycles[0].state, 'at_risk');
  assert.equal(cycles[0].riskKind, 'paused');
  assert.equal(cycles[0].intentReason, 'not_using');
  assert.equal(cycles[0].intentComment, 'busy for a bit');
});

test('an event with no cycle attaches to the open cycle', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-05-01T00:00:00.000Z', kind: 'past_due', cycleStartedAt: null }),
    ],
    NOW,
  );
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].state, 'at_risk');
});

// ---------------------------------------------------------------
// Retention — the rule that matters
// ---------------------------------------------------------------

test('a two-week churn is answerable at EVERY horizon straight away', () => {
  // Gone after a fortnight. We know it reached none of the horizons, so not one
  // of them may park it as maturing — that is what would inflate retention.
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-12-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-12-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-12-15T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-12-01T00:00:00.000Z', reason: 'not_using' }),
    ],
    NOW,
  );
  for (const row of retentionByHorizon(cycles, NOW)) {
    assert.equal(row.answerable, 1, `${row.months}mo should be answerable`);
    assert.equal(row.churned, 1, `${row.months}mo should count the churn`);
    assert.equal(row.maturing, 0, `${row.months}mo must not call it maturing`);
    assert.equal(row.retentionPct, 0);
  }
});

test('a churn past one horizon is retained there and churned at the longer ones', () => {
  // Forty days: survived the first month, never reached the third.
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-12-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-12-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2027-01-10T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-12-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const rows = retentionByHorizon(cycles, NOW);
  assert.equal(rows.find((r) => r.months === 1)!.retained, 1);
  assert.equal(rows.find((r) => r.months === 1)!.retentionPct, 100);
  for (const months of [3, 6, 12] as const) {
    const row = rows.find((r) => r.months === months)!;
    assert.equal(row.churned, 1, `${months}mo should count the churn`);
    assert.equal(row.maturing, 0, `${months}mo must not wait for the calendar`);
  }
});

test('a live young cycle is maturing, with the date its answer is due', () => {
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2027-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2027-01-01T00:00:00.000Z' })],
    NOW,
  );
  const rows = retentionByHorizon(cycles, NOW);
  const twelve = rows.find((r) => r.months === 12)!;
  assert.equal(twelve.answerable, 0);
  assert.equal(twelve.maturing, 1);
  assert.equal(twelve.retentionPct, null, 'never render an unmeasured horizon as 0%');
  assert.equal(twelve.firstAnswerDue?.slice(0, 10), '2028-01-01');
});

test('a cycle exactly on the horizon counts as retained', () => {
  // Started precisely one month before now.
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2026-12-15T12:00:00.000Z', kind: 'started', cycleStartedAt: '2026-12-15T12:00:00.000Z' })],
    NOW,
  );
  const one = retentionByHorizon(cycles, NOW).find((r) => r.months === 1)!;
  assert.equal(one.answerable, 1);
  assert.equal(one.retained, 1);
  assert.equal(one.retentionPct, 100);
});

test('a cycle that outlived a horizon before ending is retained at it', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-08-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const rows = retentionByHorizon(cycles, NOW);
  assert.equal(rows.find((r) => r.months === 6)!.retained, 1, 'survived 6 months');
  assert.equal(rows.find((r) => r.months === 12)!.churned, 1, 'did not survive 12');
});

test('retentionByPlan splits by plan code and orders by size', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'pro' }),
      ev({ userId: 'u2', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'pro' }),
      ev({ userId: 'u3', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'starter' }),
    ],
    NOW,
  );
  const rows = retentionByPlan(cycles, NOW);
  assert.deepEqual(rows.map((r) => r.planCode), ['pro', 'starter']);
  assert.equal(rows[0].cycles, 2);
});

// ---------------------------------------------------------------
// Income stability
// ---------------------------------------------------------------

test('bandFor places a cycle by elapsed calendar months', () => {
  const start = '2026-01-01T00:00:00.000Z';
  assert.equal(bandFor(start, new Date('2026-01-20T00:00:00.000Z')).key, '0-1');
  assert.equal(bandFor(start, new Date('2026-02-15T00:00:00.000Z')).key, '1-3');
  assert.equal(bandFor(start, new Date('2026-05-15T00:00:00.000Z')).key, '3-6');
  assert.equal(bandFor(start, new Date('2026-08-15T00:00:00.000Z')).key, '6-12');
  assert.equal(bandFor(start, new Date('2027-03-15T00:00:00.000Z')).key, '12+');
});

test('revenue splits across the bands and headlines the stable share', () => {
  const cycles = cyclesFromEvents(
    [
      // Two years in — very stable, £39.99.
      ev({ userId: 'u1', at: '2025-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2025-01-01T00:00:00.000Z' }),
      // A fortnight in — trial phase, £39.99.
      ev({ userId: 'u2', at: '2027-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2027-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const summary = revenueByTenureBand(cycles, NOW);
  assert.equal(summary.customers, 2);
  assert.equal(summary.mrrPence, 7998);
  assert.equal(summary.stableMrrPence, 3999);
  assert.equal(summary.stableSharePct, 50);
  assert.equal(summary.bands.find((b) => b.key === '12+')!.customers, 1);
  assert.equal(summary.bands.find((b) => b.key === '0-1')!.customers, 1);
});

test('an ended cycle contributes no live revenue', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2025-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2025-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-06-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2025-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const summary = revenueByTenureBand(cycles, NOW);
  assert.equal(summary.customers, 0);
  assert.equal(summary.mrrPence, 0);
  assert.equal(summary.stableSharePct, null);
});

test('a manual plan with no price counts as a customer but is reported unpriced', () => {
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: null, mrrPence: null, source: 'manual' })],
    NOW,
  );
  const summary = revenueByTenureBand(cycles, NOW);
  assert.equal(summary.customers, 1);
  assert.equal(summary.mrrPence, 0);
  assert.equal(summary.unpriced, 1);
});

test('at-risk revenue is counted and flagged, not dropped', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2025-06-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2025-06-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2027-01-02T00:00:00.000Z', kind: 'past_due', cycleStartedAt: '2025-06-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const summary = revenueByTenureBand(cycles, NOW);
  assert.equal(summary.customers, 1);
  assert.equal(summary.mrrPence, 3999);
  assert.equal(summary.atRisk, 1);
  assert.equal(summary.atRiskMrrPence, 3999);
});

test('an annual subscriber banded by elapsed time, priced by the month', () => {
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2026-12-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-12-01T00:00:00.000Z', planCode: 'pro_annual', mrrPence: 3000 })],
    NOW,
  );
  const summary = revenueByTenureBand(cycles, NOW);
  // Six weeks in: the commitment is annual, the tenure is not.
  assert.equal(summary.bands.find((b) => b.key === '1-3')!.customers, 1);
  assert.equal(summary.mrrPence, 3000);
  assert.equal(summary.stableSharePct, 0);
});

test('an unpriced cycle falls back to the injected price map', () => {
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'scale', mrrPence: null })],
    NOW,
  );
  assert.equal(revenueByTenureBand(cycles, NOW, { scale: 9900 }).mrrPence, 9900);
});

// ---------------------------------------------------------------
// Why they left
// ---------------------------------------------------------------

test('reasons cross-tab against the band they left in, not where they would be now', () => {
  const cycles = cyclesFromEvents(
    [
      // Left at two months.
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-03-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'too_expensive' }),
      // Left at eight months.
      ev({ userId: 'u2', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u2', at: '2026-09-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'too_expensive' }),
    ],
    NOW,
  );
  const tab = reasonsByBand(cycles);
  assert.equal(tab.churned, 2);
  const tooExpensive = tab.reasons.find((r) => r.reason === 'too_expensive')!;
  assert.equal(tooExpensive.count, 2);
  assert.equal(tooExpensive.byBand['1-3'], 1);
  assert.equal(tooExpensive.byBand['6-12'], 1);
  assert.equal(tab.mrrLostPence, 7998);
});

test('a churn with no reason is reported as such, not dropped', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-02-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const tab = reasonsByBand(cycles);
  assert.equal(tab.reasons[0].reason, 'unknown');
  assert.equal(tab.reasons[0].label, 'No reason given');
});

test('a dead card lands in the reason breakdown as payment_failed', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-05-01T00:00:00.000Z', kind: 'past_due', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-05-20T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z', reason: 'payment_failed' }),
    ],
    NOW,
  );
  const tab = reasonsByBand(cycles);
  assert.equal(tab.reasons[0].reason, 'payment_failed');
  assert.equal(tab.reasons[0].label, 'Payment failed');
});

// ---------------------------------------------------------------
// Trend
// ---------------------------------------------------------------

test('the trend counts a mid-month churn without ever calling it active', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-11-05T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-11-05T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-11-20T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-11-05T00:00:00.000Z' }),
    ],
    NOW,
  );
  const points = monthlyTrend(cycles, new Date('2026-11-01T00:00:00.000Z'), new Date('2026-12-31T23:59:59.000Z'));
  const nov = points.find((p) => p.month === '2026-11')!;
  assert.equal(nov.started, 1);
  assert.equal(nov.churned, 1);
  assert.equal(nov.active, 0, 'gone before the month ended');
  assert.equal(points.find((p) => p.month === '2026-12')!.active, 0);
});

test('the trend shows revenue migrating up the bands', () => {
  const cycles = cyclesFromEvents(
    [ev({ userId: 'u1', at: '2026-01-10T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-10T00:00:00.000Z' })],
    NOW,
  );
  const points = monthlyTrend(cycles, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-12-31T23:59:59.000Z'));
  assert.equal(points.length, 12);
  assert.equal(points[0].byBand['0-1'], 3999, 'first month is the trial band');
  assert.equal(points[0].stableSharePct, 0);
  const august = points.find((p) => p.month === '2026-08')!;
  assert.equal(august.byBand['6-12'], 3999, 'now quite stable');
  assert.equal(august.stableSharePct, 100);
});

test('the churn rate is over those active when the month began', () => {
  const cycles = cyclesFromEvents(
    [
      ev({ userId: 'u1', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u2', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
      ev({ userId: 'u1', at: '2026-03-10T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z' }),
    ],
    NOW,
  );
  const march = monthlyTrend(cycles, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-31T23:59:59.000Z'))[0];
  assert.equal(march.churnRatePct, 50);
});

test('the trend is empty when there are no cycles', () => {
  assert.deepEqual(monthlyTrend([], new Date('2026-01-01T00:00:00.000Z'), NOW), []);
  assert.equal(firstCycleMonth([]), null);
});

// ---------------------------------------------------------------
// Filters
// ---------------------------------------------------------------

const MIXED: SubEvent[] = [
  ev({ userId: 'a', at: '2026-01-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'pro' }),
  ev({ userId: 'a', at: '2026-02-01T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-01-01T00:00:00.000Z', planCode: 'pro', reason: 'too_expensive' }),
  ev({ userId: 'b', at: '2026-06-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-06-01T00:00:00.000Z', planCode: 'starter' }),
  ev({ userId: 'b', at: '2027-01-05T00:00:00.000Z', kind: 'ended', cycleStartedAt: '2026-06-01T00:00:00.000Z', planCode: 'starter', reason: 'not_using' }),
  ev({ userId: 'c', at: '2026-03-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-03-01T00:00:00.000Z', planCode: 'pro' }),
  ev({ userId: 'd', at: '2026-04-01T00:00:00.000Z', kind: 'started', cycleStartedAt: '2026-04-01T00:00:00.000Z', planCode: null }),
];

test('planCodesIn lists the plans present, busiest first, manual grants as "none"', () => {
  assert.deepEqual(planCodesIn(cyclesFromEvents(MIXED, NOW)), ['pro', 'none', 'starter']);
});

test('cyclesOnPlan narrows to one plan, and a falsy code means all', () => {
  const cycles = cyclesFromEvents(MIXED, NOW);
  assert.equal(cyclesOnPlan(cycles, 'pro').length, 2);
  assert.equal(cyclesOnPlan(cycles, 'starter').length, 1);
  assert.equal(cyclesOnPlan(cycles, 'none').length, 1, 'a hand-granted plan is reachable as "none"');
  assert.equal(cyclesOnPlan(cycles, null).length, 4, 'no filter means everything');
  assert.equal(cyclesOnPlan(cycles, 'nonsense').length, 0);
});

test('cyclesEndedSince keeps only endings, and only inside the window', () => {
  const cycles = cyclesFromEvents(MIXED, NOW);
  assert.equal(cyclesEndedSince(cycles, null).length, 2, 'no window still means endings only');
  // A 30-day window from 2027-01-15 reaches back to 2026-12-16.
  const since = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
  const recent = cyclesEndedSince(cycles, since);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].userId, 'b');
});

test('the window narrows the reasons cross-tab without touching retention', () => {
  const cycles = cyclesFromEvents(MIXED, NOW);
  const since = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();

  // The cross-tab follows the window.
  assert.equal(reasonsByBand(cyclesEndedSince(cycles, since)).churned, 1);
  assert.equal(reasonsByBand(cycles).churned, 2);

  // Retention must NOT: filtering it to a recent window would drop the older
  // cohorts that are the only ones old enough to answer the long horizons, and
  // push the figure towards 100%.
  //
  // At twelve months only the two ENDED cycles are answerable — 'a' left after
  // a month and 'b' after seven, so we know neither reached a year. 'c' and 'd'
  // are still live and younger than a year, so they are maturing, not retained.
  const allTime = retentionByHorizon(cycles, NOW).find((r) => r.months === 12)!;
  assert.equal(allTime.answerable, 2);
  assert.equal(allTime.churned, 2);
  assert.equal(allTime.maturing, 2);
  assert.equal(allTime.retentionPct, 0);
});

test('a plan filter applies to retention as well, since it is not a time lens', () => {
  const cycles = cyclesOnPlan(cyclesFromEvents(MIXED, NOW), 'pro');
  assert.equal(cycles.length, 2, "'a' who left and 'c' who is still here");
  const twelve = retentionByHorizon(cycles, NOW).find((r) => r.months === 12)!;
  assert.equal(twelve.churned, 1, "only 'a', who left after a month");
  assert.equal(twelve.maturing, 1, "'c' is still live and under a year old");
  assert.equal(twelve.answerable, 1, 'a maturing cycle is not an answer');
});
