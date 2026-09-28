import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionCounts, analysisByBlocker, completenessBucket, keepRates, memberFact, pct, ROLE_ROWS, type ShownDay } from './admin-stats.ts';
import { DEFAULT_ABOUT } from '../profile/about.ts';

const about = (o: Partial<typeof DEFAULT_ABOUT>) => ({ ...DEFAULT_ABOUT, ...o });

test('completeness buckets: 0 / 1–49 / 50–99 / 100', () => {
  assert.deepEqual([0, 1, 49, 50, 99, 100, 120, NaN].map(completenessBucket), ['0', '1-49', '1-49', '50-99', '50-99', '100', '100', '0']);
});

test('roles read the quiz’s own words; a member with none is "Not answered"', () => {
  assert.equal(ROLE_ROWS.investor, 'Investor buying');
  assert.equal(memberFact('u', about({ roles: ['r2r', 'sourcer'], mainRole: 'sourcer' }), 60).role, 'sourcer');
  assert.equal(memberFact('u', about({ roles: ['r2r'] }), 60).role, 'r2r');
  assert.equal(memberFact('u', null, 0).role, 'none');
});

test('keep rate: kept the same Today-day, per role and completeness; a keep another day does not count', () => {
  const members = [memberFact('a', about({ roles: ['investor'], dealsWanted12m: '2-5' }), 100), memberFact('b', about({ roles: ['r2r'] }), 30)];
  const days: ShownDay[] = [
    { userId: 'a', day: '2026-09-27', dealIds: ['d1', 'd2', 'd3', 'd4', 'd5'] },
    { userId: 'b', day: '2026-09-27', dealIds: ['d1', 'd6'] },
    { userId: 'x', day: '2026-09-27', dealIds: ['d1'] },
  ];
  const keeps = [
    { userId: 'a', dealId: 'd1', at: '2026-09-27T09:00:00Z' },
    { userId: 'a', dealId: 'd2', at: '2026-09-28T09:00:00Z' },
    { userId: 'b', dealId: 'd6', at: '2026-09-28T06:30:00Z' },
  ];
  const r = keepRates(days, keeps, members);
  assert.deepEqual({ shown: r.total.shown, kept: r.total.kept }, { shown: 7, kept: 2 }, 'the 06:30 keep is still the 27th’s Today; x is left out');
  assert.equal(r.byRole.find((x) => x.key === 'investor')?.kept, 1);
  assert.equal(r.byCompleteness.find((x) => x.key === '1-49')?.rate, 0.5);
  assert.equal(r.byDealsWanted.find((x) => x.key === '2-5')?.shown, 5);
  assert.equal(pct(r.byRole.find((x) => x.key === 'manager')!.rate), '—');
});

test('open → Full analysis by what holds them back, and the tailoring actions by step', () => {
  const members = [memberFact('a', about({ blocker: 'numbers' }), 50), memberFact('b', about({ blocker: 'consent' }), 50)];
  const ev = (user_id: string, kind: string, deal_id: string, extras: Record<string, unknown> = {}) => ({ user_id, kind, deal_id, extras, occurred_at: '2026-09-27T10:00:00Z' });
  const rows = analysisByBlocker([ev('a', 'deal_open', 'd1'), ev('a', 'full_analysis', 'd1'), ev('a', 'deal_open', 'd2'), ev('b', 'deal_open', 'd3')], members);
  assert.deepEqual(rows.find((x) => x.key === 'numbers'), { key: 'numbers', label: 'Knowing the numbers', members: 1, opened: 2, analysed: 1, rate: 0.5 });
  assert.equal(rows.find((x) => x.key === 'consent')?.rate, 0);
  const actions = actionCounts(
    [
      { user_id: 'a', kind: 'tailoring_prompt', extras: { step: 'accepted' } },
      { user_id: 'a', kind: 'tailoring_prompt', extras: { step: 'dismissed' } },
      { user_id: 'b', kind: 'tailoring_mode', extras: { criterion: 'bedrooms', mode: 'nice' } },
      { user_id: 'b', kind: 'email_feedback', extras: { answer: 'yes', part: 'teaser' } },
      { user_id: 'b', kind: 'email_feedback', extras: { answer: 'no', via: 'link' } },
      { user_id: 'b', kind: 'tailoring_widen', extras: { step: 'applied', env: 'preview' } },
      { user_id: 'x', kind: 'tailoring_widen', extras: { step: 'applied' } },
    ],
    members,
  );
  assert.deepEqual(actions.find((x) => x.kind === 'tailoring_prompt')?.by, { accepted: 1, dismissed: 1 });
  assert.deepEqual(actions.find((x) => x.kind === 'tailoring_mode')?.by, { nice: 1 });
  assert.equal(actions.find((x) => x.kind === 'email_feedback')?.total, 1, 'only the teaser answers, not the pick’s');
  assert.equal(actions.find((x) => x.kind === 'tailoring_widen')?.total, 0, 'a preview event and an unknown account are left out');
});
