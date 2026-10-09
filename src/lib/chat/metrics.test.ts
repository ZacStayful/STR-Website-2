import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeShare, money, outcomes, pct, perDay, type TurnFact } from './metrics.ts';

const row = (o: Partial<TurnFact>): TurnFact => ({ createdAt: '2026-10-09T10:00:00Z', surface: 'full', status: 'answered', outcome: 'answered', rawPence: 1.5, chargedBasePence: 7.5, chargedFacePence: 7.5, inputTokens: 500, outputTokens: 200, cacheReadTokens: 3500, cacheWriteTokens: 0, ...o });

test('questions per day by surface, zeros included', () => {
  const d = perDay([row({}), row({ surface: 'quick' }), row({ createdAt: '2026-10-08T10:00:00Z' })], 3, new Date('2026-10-09T12:00:00Z'));
  assert.deepEqual(d, [
    { day: '2026-10-09', quick: 1, full: 1 },
    { day: '2026-10-08', quick: 0, full: 1 },
    { day: '2026-10-07', quick: 0, full: 0 },
  ]);
});

test('outcomes leave failed questions out of the rates', () => {
  const o = outcomes([row({}), row({ status: 'no_answer', outcome: 'could_not_answer' }), row({ outcome: 'member_unhappy' }), row({ status: 'failed', outcome: null })]);
  assert.equal(o.asked, 3);
  assert.equal(o.answered, 2);
  assert.equal(o.dontKnow, 1);
  assert.equal(o.failed, 1);
  assert.equal(pct(o.dontKnowRate), '33%');
  assert.equal(pct(o.unhappyRate), '50%');
});

test('money: cost, revenue, margin, median charge and the cache-hit rate', () => {
  const m = money([row({}), row({ chargedBasePence: 0, chargedFacePence: 0, status: 'no_answer', rawPence: 0.5, cacheReadTokens: 0, cacheWriteTokens: 3500 })]);
  assert.equal(m.rawPence, 2);
  assert.equal(m.revenuePence, 7.5);
  assert.equal(m.marginPence, 5.5);
  assert.equal(m.medianChargePence, 7.5);
  assert.equal(pct(m.cacheHitRate), '44%');
  assert.equal(pct(m.anyCacheShare), '50%');
});

test('weekly active: at all, and beyond the chat', () => {
  const w = activeShare(
    ['2026-10-05'],
    new Map([['2026-10-05', new Set(['a', 'b', 'c'])]]),
    new Map([['2026-10-05', new Map([['a', new Set(['si_chat_full'])], ['b', new Set(['si_chat_full', 'keep'])]])]]),
    'si_chat_full',
  );
  assert.deepEqual(w, [{ week: '2026-10-05', chatUsers: 3, active: 2, activeBeyondChat: 1 }]);
});
