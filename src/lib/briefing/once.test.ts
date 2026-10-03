import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_MS, claimDecision, shouldCharge, type ExistingRow } from './once.ts';

/**
 * A small model of the pass against member_briefings and the ledger: the
 * same two rules the store and the runner use, driven through retries,
 * overlapping runs and a crash between the charge and the row update.
 */
function world() {
  const rows = new Map<string, ExistingRow & { id: string }>();
  const ledger: { actionId: string; pence: number }[] = [];
  let ids = 0;
  const spent = (actionId: string) => ledger.filter((l) => l.actionId === actionId).reduce((n, l) => n + l.pence, 0);
  /** One run for one member: claim, write, charge, finish; `crashAfterCharge` dies before the row is finished. */
  function run(user: string, day: string, now: Date, opts: { crashAfterCharge?: boolean } = {}): 'done' | 'busy' | 'crashed' {
    const key = `${user}|${day}`;
    const d = claimDecision(rows.get(key) ?? null, now);
    if (d.kind === 'busy') return 'busy';
    let actionId: string;
    if (d.kind === 'insert') {
      actionId = `act-${++ids}`;
      rows.set(key, { id: key, status: 'generating', createdAt: now.toISOString(), actionId });
    } else {
      actionId = d.actionId!;
      rows.get(key)!.createdAt = now.toISOString();
    }
    if (shouldCharge(spent(actionId))) ledger.push({ actionId, pence: 1.4 });
    if (opts.crashAfterCharge) return 'crashed';
    rows.get(key)!.status = 'ready';
    return 'done';
  }
  return { rows, ledger, run };
}

const t0 = new Date('2026-10-06T06:40:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

test('one briefing and one charge per member per UK day across retries', () => {
  const w = world();
  assert.equal(w.run('u', '2026-10-06', t0), 'done');
  assert.equal(w.run('u', '2026-10-06', at(60_000)), 'busy'); // a retry
  assert.equal(w.run('u', '2026-10-06', at(15 * 60_000)), 'busy'); // the 06:55 run
  assert.equal(w.ledger.length, 1);
  assert.equal(w.rows.size, 1);
  // The next day is a new briefing.
  assert.equal(w.run('u', '2026-10-07', at(86_400_000)), 'done');
  assert.equal(w.ledger.length, 2);
});

test('an overlapping run leaves a row another run is still writing', () => {
  const w = world();
  assert.equal(w.run('u', 'd', t0, { crashAfterCharge: true }), 'crashed');
  assert.equal(w.run('u', 'd', at(STALE_MS - 1)), 'busy');
  assert.equal(w.ledger.length, 1);
});

test('a run that died after charging is reclaimed and never charges again', () => {
  const w = world();
  assert.equal(w.run('u', 'd', t0, { crashAfterCharge: true }), 'crashed');
  assert.equal(w.run('u', 'd', at(STALE_MS + 1)), 'done');
  assert.equal(w.ledger.length, 1);
  assert.equal(w.rows.get('u|d')!.status, 'ready');
});

test('shouldCharge: nothing on the ledger yet', () => {
  assert.equal(shouldCharge(0), true);
  assert.equal(shouldCharge(1.4), false);
});
