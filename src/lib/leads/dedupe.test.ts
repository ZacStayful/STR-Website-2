import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaseCutoff, reuseSince, QUEUED_LEASE_MS, REUSE_WINDOW_MS } from './dedupe.ts';

test('Batch 21 (C3, D10): a resubmission is matched within the hour; a queued lead is claimable after five minutes', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');
  assert.equal(REUSE_WINDOW_MS, 3_600_000);
  assert.equal(QUEUED_LEASE_MS, 300_000);
  assert.equal(reuseSince(now), '2026-10-01T09:00:00.000Z');
  assert.equal(leaseCutoff(now), '2026-10-01T09:55:00.000Z');
});
