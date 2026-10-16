import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSpend, describeSteps, laterCheck, spendLine, splitAtCap, type PricedStep, type SpendInput } from './spend.ts';

const analysis = (index: number, face = 400, o: Partial<PricedStep> = {}): PricedStep => ({ index, kind: 'full_analysis', basePence: face, facePence: face, opensDeal: false, ...o });

function input(o: Partial<SpendInput> = {}): SpendInput {
  return { steps: [analysis(0), analysis(1), analysis(2)], spendableBasePence: 4000, balanceFacePence: 4000, capFacePence: 2000, lowCreditPence: 500, autoTopupOn: false, admin: false, ...o };
}

test('nothing charged: free', () => {
  assert.deepEqual(decideSpend(input({ steps: [] })), { kind: 'free' });
});

test('£40 credit, three £4 analyses: runs, no confirm', () => {
  const d = decideSpend(input());
  assert.equal(d.kind, 'run');
  assert.ok(d.kind === 'run' && d.now.length === 3 && d.nowFacePence === 1200 && d.balanceAfterFacePence === 2800);
});

test('the balance would end under the low-credit line: one confirm', () => {
  const d = decideSpend(input({ spendableBasePence: 1500, balanceFacePence: 1500 }));
  assert.equal(d.kind, 'confirm');
  assert.ok(d.kind === 'confirm' && d.reason === 'low_balance' && d.balanceAfterFacePence === 300);
});

test('exactly on the line is not under it', () => {
  assert.equal(decideSpend(input({ spendableBasePence: 1700, balanceFacePence: 1700 })).kind, 'run');
});

test('auto top-up on: no low-balance confirm (Zac’s default)', () => {
  assert.equal(decideSpend(input({ spendableBasePence: 1500, balanceFacePence: 1500, autoTopupOn: true })).kind, 'run');
});

test('not enough credit for what would run: nothing runs', () => {
  const d = decideSpend(input({ spendableBasePence: 1000, balanceFacePence: 1000 }));
  assert.deepEqual(d, { kind: 'insufficient', requiredBasePence: 1200, availableBasePence: 1000, requiredFacePence: 1200 });
});

test('eight analyses: up to £20 now, the other three wait for a yes', () => {
  const steps = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => analysis(i));
  const d = decideSpend(input({ steps, spendableBasePence: 6000, balanceFacePence: 6000 }));
  assert.equal(d.kind, 'run');
  assert.ok(d.kind === 'run' && d.now.length === 5 && d.nowFacePence === 2000 && d.later.length === 3 && d.laterFacePence === 1200);
});

test('the cap is in order: a cheaper step after it never jumps the queue', () => {
  const { now, later } = splitAtCap([analysis(0, 1500), analysis(1, 600), analysis(2, 100)], 2000);
  assert.deepEqual(now.map((s) => s.index), [0]);
  assert.deepEqual(later.map((s) => s.index), [1, 2]);
});

test('a first step past the cap asks before anything', () => {
  const d = decideSpend(input({ steps: [analysis(0, 2500)], spendableBasePence: 9000, balanceFacePence: 9000 }));
  assert.ok(d.kind === 'confirm' && d.reason === 'over_cap' && d.now.length === 0 && d.later.length === 1);
});

test('only the part that runs now has to be affordable; the rest is checked when asked', () => {
  const steps = [0, 1, 2, 3, 4, 5].map((i) => analysis(i));
  const d = decideSpend(input({ steps, spendableBasePence: 2600, balanceFacePence: 2600 }));
  assert.equal(d.kind, 'run');
  assert.deepEqual(laterCheck({ steps: [analysis(5)], spendableBasePence: 300, balanceFacePence: 300 }), { ok: false, requiredBasePence: 400, availableBasePence: 300 });
  assert.deepEqual(laterCheck({ steps: [analysis(5)], spendableBasePence: 600, balanceFacePence: 600 }), { ok: true, facePence: 400, balanceAfterFacePence: 200 });
});

test('admins are never charged and never asked', () => {
  const d = decideSpend(input({ spendableBasePence: 0, balanceFacePence: 0, admin: true }));
  assert.ok(d.kind === 'run' && d.now.length === 3 && d.nowFacePence === 0);
});

test('face and base differ (top-up credit at its spend rate): the cap is on face, affordability on base', () => {
  const steps = [0, 1, 2, 3].map((i) => analysis(i, 520, { basePence: 400 }));
  const d = decideSpend(input({ steps, spendableBasePence: 1600, balanceFacePence: 5000 }));
  assert.ok(d.kind === 'run' && d.now.length === 3 && d.nowBasePence === 1200);
});

test('the spend line', () => {
  assert.equal(spendLine([analysis(0), analysis(1), analysis(2)]), 'Running 3 full analyses — £12');
  assert.equal(spendLine([analysis(0, 460, { opensDeal: true })]), 'Running a full analysis (with opening 1 deal) — £4.60');
  assert.equal(spendLine([{ index: 0, kind: 'deep_search', basePence: 750, facePence: 750, opensDeal: false, aboutFacePence: 420 }]), 'Running a deep search — about £4.20, up to £7.50');
  assert.equal(spendLine([{ index: 0, kind: 'check_link', basePence: 3, facePence: 3, opensDeal: false }]), 'Checking the listing — 3p');
  assert.equal(describeSteps([{ kind: 'full_analysis' }, { kind: 'deep_report' }, { kind: 'full_analysis' }]), '2 full analyses and a Deep report');
});
