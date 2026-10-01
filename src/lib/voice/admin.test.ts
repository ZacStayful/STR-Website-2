import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTotals } from './admin.ts';

test('totals: answer rate over placed outbound calls; blocked ones counted but never placed', () => {
  const t = callTotals(
    [
      { direction: 'outbound', status: 'answered', seconds: 42, charged_pence: 66, texts_sent: 1 },
      { direction: 'outbound', status: 'missed', seconds: 0, charged_pence: 42, texts_sent: 1 },
      { direction: 'outbound', status: 'blocked', seconds: null, charged_pence: 0, texts_sent: 0 },
      { direction: 'inbound', status: 'answered', seconds: 78, charged_pence: 85, texts_sent: 0 },
    ],
    13,
    4.42,
  );
  assert.equal(t.calls, 4);
  assert.equal(t.placed, 2);
  assert.equal(t.blocked, 1);
  assert.equal(t.answerRate, 0.5);
  assert.equal(t.minutes, 2);
  assert.equal(t.revenuePence, 193);
  assert.equal(t.rawCostPence, Math.round((2 * 13 + 2 * 4.42) * 100) / 100);
});
