import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedLeadStatus } from './status.ts';

test('a lead that has run never keeps the status that means it has not', () => {
  // The whole double-charge bug in one assertion. `queued` is what the drain
  // cron reads as "the report has not run yet", and it acts on that by running
  // it — so a lead whose report HAS run must never carry it, whatever the
  // verdict or the funnel's policy, or it is analysed and charged for twice.
  for (const qualified of [true, false]) {
    for (const policy of ['crm_flagged', 'hold'] as const) {
      const status = completedLeadStatus(qualified, policy);
      assert.notEqual(status, 'queued', `qualified=${qualified} policy=${policy} stayed queued`);
    }
  }
});

test('a qualified lead is new, and an unqualified one follows the funnel policy', () => {
  assert.equal(completedLeadStatus(true, 'crm_flagged'), 'new');
  assert.equal(completedLeadStatus(true, 'hold'), 'new');
  // 'hold' keeps it back for the owner to review rather than sending it on.
  assert.equal(completedLeadStatus(false, 'hold'), 'held');
  assert.equal(completedLeadStatus(false, 'crm_flagged'), 'new');
});
