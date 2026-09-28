import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageByProfile } from './usage.ts';
import type { LedgerLine } from '../credit/usage-breakdown.ts';

const line = (over: Partial<LedgerLine> = {}): LedgerLine => ({ kind: 'debit', action: 'todays_5', provider: 'marketplace', unit: 'todays_5', actionId: null, facePence: 43, metadata: null, ...over });
const profiles = [
  { id: 'a', name: 'My deals', deletedAt: null },
  { id: 'b', name: 'Client: JS', deletedAt: '2026-09-20T00:00:00Z' },
];

test('usage splits by the profile each charge names; refunds follow their charge; the rest is Account or Team members', () => {
  const rows = usageByProfile(
    [
      line({ metadata: { profile_id: 'a' } }),
      line({ metadata: { profile_id: 'a' } }),
      line({ metadata: { profile_id: 'b' }, facePence: 100, actionId: 'open-1', action: 'deal_open' }),
      line({ kind: 'refund', facePence: 100, actionId: 'open-1', action: 'deal_open' }),
      line({ metadata: { profile_id: 'b' }, facePence: 14 }),
      line({ metadata: null, facePence: 50, action: 'report' }),
      line({ metadata: { member_id: 'm1', profile_id: 'mp' }, facePence: 43 }),
      line({ metadata: { profile_id: 'someone-else' }, facePence: 7 }),
    ],
    profiles,
  );
  assert.deepEqual(
    rows.map((r) => [r.label, r.facePence]),
    [
      ['My deals', 86],
      ['Client: JS (deleted profile)', 14],
      ['Team members', 43],
      ['Account (not for one profile)', 57],
    ],
  );
  assert.equal(rows.reduce((n, r) => n + r.pct, 0), 100);
});

test('nothing spent, no rows', () => {
  assert.deepEqual(usageByProfile([], profiles), []);
});
