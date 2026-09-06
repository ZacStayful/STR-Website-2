import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuestion, memoryStore, memoryLedger } from './resolve.ts';
import type { Question } from './types.ts';

type P = { id: string };
type T = { v: number };

function q(rungs: Question<P, T>['rungs']): Question<P, T> {
  return { name: 'test', key: (p) => p.id, rungs };
}
const enabled = () => true;
const HOUR = 3600_000;

test('stops at the first sufficient rung and never calls later ones', async () => {
  const calls: string[] = [];
  const question = q([
    { provider: 'internal', level: 1, costPence: 0, ttlMs: HOUR, run: async () => { calls.push('a'); return null; } },
    { provider: 'airbtics', level: 3, costPence: 5, ttlMs: HOUR, run: async () => { calls.push('b'); return { v: 1 }; } },
    { provider: 'pmi', level: 4, costPence: 9, ttlMs: HOUR, run: async () => { calls.push('c'); return { v: 2 }; } },
  ]);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  const r = await resolveQuestion(deps, question, { id: 'x' }, { mode: 'full', userId: 'u1' });
  assert.deepEqual(r.value, { v: 1 });
  assert.equal(r.provider, 'airbtics');
  assert.equal(r.level, 3);
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(r.costPence, 5);
  assert.equal(deps.ledger.calls.filter((c) => !c.cacheHit).length, 1);
});

test('quick mode never climbs to level 4; stale cache is returned when nothing else can answer', async () => {
  const store = memoryStore();
  const ledger = memoryLedger();
  const question = q([{ provider: 'pmi', level: 4, costPence: 9, ttlMs: HOUR, run: async () => ({ v: 7 }) }]);
  const r1 = await resolveQuestion({ store, ledger, enabled }, question, { id: 'x' }, { mode: 'quick' });
  assert.equal(r1.unavailable, true);
  assert.equal(r1.value, null);
  // A full run fills the cache…
  const r2 = await resolveQuestion({ store, ledger, enabled }, question, { id: 'x' }, { mode: 'full' });
  assert.deepEqual(r2.value, { v: 7 });
  // …and a later quick run past the TTL gets the stale answer instead of nothing.
  const later = () => new Date(Date.now() + 2 * HOUR);
  const r3 = await resolveQuestion({ store, ledger, enabled, now: later }, question, { id: 'x' }, { mode: 'quick' });
  assert.deepEqual(r3.value, { v: 7 });
  assert.equal(r3.stale, true);
  assert.equal(r3.cached, true);
});

test('fresh cache hits skip every rung and cost nothing', async () => {
  let runs = 0;
  const question = q([{ provider: 'airbtics', level: 3, costPence: 5, ttlMs: HOUR, run: async () => { runs++; return { v: 1 }; } }]);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  await resolveQuestion(deps, question, { id: 'x' }, { mode: 'quick' });
  const r = await resolveQuestion(deps, question, { id: 'x' }, { mode: 'quick' });
  assert.equal(runs, 1);
  assert.equal(r.cached, true);
  assert.equal(r.costPence, 0);
  assert.equal(deps.ledger.calls.at(-1)?.cacheHit, true);
});

test('budget exhaustion skips paid rungs (global and per member)', async () => {
  process.env.BROKER_BUDGET_AIRBTICS = '9';
  process.env.BROKER_MEMBER_BUDGET_AIRBTICS = '5';
  try {
    let runs = 0;
    const question = q([{ provider: 'airbtics', level: 3, costPence: 5, ttlMs: HOUR, run: async () => { runs++; return { v: runs }; } }]);
    const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
    const a = await resolveQuestion(deps, question, { id: 'a' }, { mode: 'quick', userId: 'u1' });
    assert.deepEqual(a.value, { v: 1 });
    // Member u1 has spent 5 of 5 → skipped for u1…
    const b = await resolveQuestion(deps, question, { id: 'b' }, { mode: 'quick', userId: 'u1' });
    assert.equal(b.unavailable, true);
    // …but u2 may still spend within the global cap (5 spent of 9; another 5 would breach it).
    const c = await resolveQuestion(deps, question, { id: 'c' }, { mode: 'quick', userId: 'u2' });
    assert.equal(c.unavailable, true);
    assert.equal(runs, 1);
  } finally {
    delete process.env.BROKER_BUDGET_AIRBTICS;
    delete process.env.BROKER_MEMBER_BUDGET_AIRBTICS;
  }
});

test('disabled providers are removed from the ladder; insufficient answers continue; throwing rungs are logged and skipped', async () => {
  const question = q([
    { provider: 'airroi', level: 3, costPence: 1, ttlMs: HOUR, run: async () => ({ v: 99 }) },
    { provider: 'airbtics', level: 3, costPence: 5, ttlMs: HOUR, run: async () => ({ v: 0 }), sufficient: (x) => x.v > 0 },
    { provider: 'pmi', level: 3, costPence: 4, ttlMs: HOUR, run: async () => { throw new Error('boom'); } },
    { provider: 'internal', level: 1, costPence: 0, ttlMs: HOUR, run: async () => ({ v: 3 }) },
  ]);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled: (p: string) => p !== 'airroi' };
  const r = await resolveQuestion(deps, question, { id: 'x' }, { mode: 'quick' });
  assert.deepEqual(r.value, { v: 3 });
  assert.equal(r.provider, 'internal');
  const failed = deps.ledger.calls.find((c) => c.provider === 'pmi');
  assert.equal(failed?.ok, false);
  assert.equal(failed?.costPence, 0);
});

test('concurrent identical requests share one call', async () => {
  let runs = 0;
  const question = q([{ provider: 'airbtics', level: 3, costPence: 5, ttlMs: HOUR, run: async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return { v: 1 }; } }]);
  const deps = { store: memoryStore(), ledger: memoryLedger(), enabled };
  const [a, b] = await Promise.all([
    resolveQuestion(deps, question, { id: 'same' }, { mode: 'quick' }),
    resolveQuestion(deps, question, { id: 'same' }, { mode: 'quick' }),
  ]);
  assert.equal(runs, 1);
  assert.deepEqual(a.value, b.value);
});
