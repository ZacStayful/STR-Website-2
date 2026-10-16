import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionRevenue, actionsPerDay, failures, nextWeekActive, safety, turnMargin, undoRates, type InstructionFact, type StepFact } from './metrics.ts';

const now = new Date('2026-10-16T12:00:00Z');

const ins = (over: Partial<InstructionFact> = {}): InstructionFact => ({
  id: 'i1',
  userId: 'u1',
  createdAt: '2026-10-16T09:00:00Z',
  status: 'done',
  decision: 'free',
  confirmKind: null,
  confirmAnswer: null,
  chargedStartedAt: null,
  stoppedAt: null,
  reportKind: null,
  planned: true,
  ...over,
});

const step = (over: Partial<StepFact> = {}): StepFact => ({
  instructionId: 'i1',
  action: 'pass',
  status: 'done',
  createdAt: '2026-10-16T09:00:00Z',
  finishedAt: '2026-10-16T09:00:01Z',
  undoneAt: null,
  errorCode: null,
  autoReported: false,
  chargedBasePence: null,
  estimateBasePence: 0,
  ...over,
});

test('actions per day count what happened, by type, every day in the window', () => {
  const days = actionsPerDay(
    [ins(), ins({ id: 'i2', status: 'cancelled' }), ins({ id: 'i3', reportKind: 'bug', planned: false })],
    [step(), step({ action: 'full_analysis', status: 'handed_out' }), step({ status: 'failed' }), step({ status: 'dropped' }), step({ finishedAt: '2026-10-14T09:00:00Z' })],
    7,
    now,
  );
  assert.equal(days.length, 7);
  assert.equal(days[0].day, '2026-10-16');
  assert.equal(days[0].counts.pass, 1);
  assert.equal(days[0].counts.full_analysis, 1);
  assert.equal(days[0].total, 2);
  assert.equal(days[0].instructions, 1, 'a cancelled instruction (answer never delivered), or a report alone, is not counted');
  assert.equal(days[2].counts.pass, 1);
});

test('action revenue uses each step’s own charge, the typical price only where none is recorded, and only for charged steps that happened', () => {
  const r = actionRevenue([
    step({ action: 'full_analysis', chargedBasePence: 400 }),
    step({ action: 'full_analysis', chargedBasePence: 200 }),
    step({ action: 'check_link', chargedBasePence: null, estimateBasePence: 3 }),
    step({ action: 'deep_search', status: 'failed', chargedBasePence: 0 }),
    step({ action: 'pass', chargedBasePence: null }),
  ]);
  assert.deepEqual(
    r.rows.map((x) => [x.action, x.count, x.revenuePence, x.estimated]),
    [
      ['full_analysis', 2, 600, 0],
      ['check_link', 1, 3, 1],
    ],
  );
  assert.equal(r.totalPence, 603);
  assert.equal(r.estimated, 1);
});

test('the AI line’s margin counts only the questions that gave an instruction', () => {
  const m = turnMargin(new Set(['i1', 'i2']), [
    { id: 'i1', rawPence: 3, chargedBasePence: 15 },
    { id: 'i2', rawPence: 2, chargedBasePence: 0 },
    { id: 'other', rawPence: 50, chargedBasePence: 100 },
  ]);
  assert.equal(m.turns, 2);
  assert.equal(m.charged, 1);
  assert.equal(m.rawPence, 5);
  assert.equal(m.revenuePence, 15);
  assert.equal(m.marginPence, 10);
  assert.ok(Math.abs((m.marginRate ?? 0) - 10 / 15) < 1e-9);
  assert.equal(turnMargin(new Set(), []).marginRate, null);
});

test('Stops split into before anything was charged and “Stop the rest”; confirms shown, yes and no; blocked; reports', () => {
  const s = safety([
    ins({ decision: 'run', stoppedAt: '2026-10-16T09:00:03Z' }),
    ins({ decision: 'run', chargedStartedAt: '2026-10-16T09:00:05Z', stoppedAt: '2026-10-16T09:00:30Z' }),
    ins({ decision: 'confirm', confirmKind: 'over_cap', confirmAnswer: 'yes' }),
    ins({ decision: 'confirm', confirmKind: 'low_balance', confirmAnswer: 'no' }),
    ins({ decision: 'confirm', confirmKind: 'low_balance' }),
    ins({ decision: 'insufficient', status: 'blocked' }),
    ins({ reportKind: 'bug', planned: false }),
    ins({ reportKind: 'feature', planned: false }),
    ins({ status: 'cancelled', decision: 'run', stoppedAt: '2026-10-16T09:00:03Z' }),
  ]);
  assert.equal(s.instructions, 6, 'a question that only filed a report is not an instruction');
  assert.equal(s.withCharges, 6);
  assert.equal(s.stopsBeforeCharge, 1);
  assert.equal(s.stopsRest, 1);
  assert.deepEqual(s.confirmsShown, { low_balance: 2, over_cap: 1 });
  assert.deepEqual(s.confirmsYes, { low_balance: 0, over_cap: 1 });
  assert.deepEqual(s.confirmsNo, { low_balance: 1, over_cap: 0 });
  assert.equal(s.blocked, 1);
  assert.equal(s.memberBugs, 1);
  assert.equal(s.featureRequests, 1);
});

test('failures group by action and code, the commonest first, with the automatic reports', () => {
  const f = failures([
    step({ action: 'full_analysis', status: 'failed', errorCode: 'failed', autoReported: true }),
    step({ action: 'full_analysis', status: 'failed', errorCode: 'failed' }),
    step({ action: 'check_link', status: 'failed', errorCode: 'fetch_failed' }),
    step({ status: 'done' }),
  ]);
  assert.deepEqual(
    f.rows.map((r) => [r.action, r.code, r.count, r.autoReported]),
    [
      ['full_analysis', 'failed', 2, 1],
      ['check_link', 'fetch_failed', 1, 0],
    ],
  );
  assert.equal(f.total, 3);
  assert.equal(f.autoReported, 1);
});

test('the Undo rate is per undoable action, of the steps that happened', () => {
  const rates = undoRates([step({ action: 'pass', undoneAt: '2026-10-16T10:00:00Z' }), step({ action: 'pass' }), step({ action: 'keep', status: 'failed' }), step({ action: 'full_analysis' })]);
  assert.deepEqual(
    rates.map((r) => r.action),
    ['keep', 'pass', 'stage_move', 'change_criteria'],
  );
  const pass = rates.find((r) => r.action === 'pass')!;
  assert.equal(pass.done, 2);
  assert.equal(pass.undone, 1);
  assert.equal(pass.rate, 0.5);
  assert.equal(rates.find((r) => r.action === 'keep')!.rate, null);
});

test('next-week weekly active compares members the eye acted for with the other full-view users, for weeks whose next week has begun', () => {
  // now (Fri 16 Oct 2026) is in the week of Monday 12 Oct.
  const weeks = ['2026-09-28', '2026-10-05', '2026-10-12'];
  const actors = new Map([['2026-10-05', new Set(['a', 'b'])]]);
  const chat = new Map([['2026-10-05', new Set(['a', 'b', 'c', 'd'])]]);
  const active = new Map([['2026-10-12', new Set(['a', 'c'])]]);
  const rows = nextWeekActive(weeks, actors, chat, active, now);
  assert.deepEqual(
    rows.map((r) => r.week),
    ['2026-09-28', '2026-10-05'],
  );
  assert.deepEqual(rows[1], { week: '2026-10-05', actors: 2, activeNext: 1, others: 2, othersActiveNext: 1 });
});
