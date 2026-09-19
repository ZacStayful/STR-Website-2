import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funnelCost, recommendTopup } from './cost.ts';
import { seedTable } from '../credit/costs.ts';
import { DEFAULT_SPEND_RATES } from '../credit/pricing.ts';

const PRESETS = [1000, 2500, 5000];

function cost(over: Partial<Parameters<typeof funnelCost>[0]> = {}) {
  return funnelCost({
    leadsPerMonth: 100,
    enhanced: false,
    table: seedTable(),
    markup: 2,
    spendRates: DEFAULT_SPEND_RATES,
    topupPresetsPence: PRESETS,
    ...over,
  });
}

test('a standard lead quotes the price the plan committed to', () => {
  // £2.08 for the report itself at the x2 funnel markup, spent at the 1.5x
  // top-up rate. The plan's £2.12 headline includes an address-autocomplete
  // session, which is charged as its own action and is not part of a report.
  const c = cost();
  assert.equal(c.perLeadPence, 208);
});

test('an enhanced lead costs about twice as much', () => {
  const c = cost({ enhanced: true });
  assert.equal(c.perLeadPence, 433);
  assert.ok(c.perLeadPence > cost().perLeadPence * 1.9, 'the PMI second opinion is the bulk of the difference');
});

test('the worst case is above the typical, because that is what solvency is checked against', () => {
  const c = cost();
  assert.ok(c.perLeadWorstCasePence > c.perLeadPence);
});

test('a month is the per-lead price times the leads', () => {
  const c = cost({ leadsPerMonth: 100 });
  assert.equal(c.monthlyPence, c.perLeadPence * 100);
  assert.equal(c.monthlyPence, 20_800);
});

test('the markup is applied — this is where a half-applied one shows up', () => {
  // The whole reason this is tested: a quote that disagrees with the charge
  // is worse than no quote at all.
  const atTwo = cost({ markup: 2 }).perLeadPence;
  const atFour = cost({ markup: 4 }).perLeadPence;
  assert.ok(atFour > atTwo * 1.9 && atFour < atTwo * 2.1, `x4 should roughly double x2, got ${atTwo} → ${atFour}`);
});

test('the top-up spend rate is applied, not just the base price', () => {
  // Quoting the base rate would under-state what a pay-per-use customer
  // actually pays by a third.
  const c = cost();
  assert.ok(c.perLeadPence > c.perLeadBasePence);
  assert.equal(c.perLeadPence, Math.round(c.perLeadBasePence * 1.5));
});

test('a nonsense spend rate under-quotes nothing — it falls back to 1, not 0', () => {
  const c = cost({ spendRates: { ...DEFAULT_SPEND_RATES, topup: 0 } });
  // perLeadBasePence is the precise figure and carries fractions of a penny;
  // perLeadPence is what a balance actually moves by, so it is whole.
  assert.equal(c.perLeadPence, Math.round(c.perLeadBasePence));
  assert.ok(c.perLeadPence > 0);
});

test('zero and nonsense lead counts give a zero month rather than NaN', () => {
  for (const n of [0, -5, Number.NaN, 0.4]) {
    const c = cost({ leadsPerMonth: n });
    assert.equal(c.monthlyPence, 0, `${n} should quote nothing`);
  }
});

test('a fractional lead count is floored, never rounded up', () => {
  assert.equal(cost({ leadsPerMonth: 10.9 }).monthlyPence, cost({ leadsPerMonth: 10 }).monthlyPence);
});

test('the recommended top-up is the smallest preset that covers the month', () => {
  assert.equal(recommendTopup(800, PRESETS), 1000);
  assert.equal(recommendTopup(1000, PRESETS), 1000, 'an exact match is covered');
  assert.equal(recommendTopup(1001, PRESETS), 2500);
  assert.equal(recommendTopup(3000, PRESETS), 5000);
});

test('a month bigger than every preset points at the biggest, not at nothing', () => {
  assert.equal(recommendTopup(99_999, PRESETS), 5000);
});

test('no month still recommends something to start with', () => {
  assert.equal(recommendTopup(0, PRESETS), 1000);
  assert.equal(recommendTopup(-100, PRESETS), 1000);
});

test('unusable presets do not produce a nonsense recommendation', () => {
  assert.equal(recommendTopup(500, []), 0);
  assert.equal(recommendTopup(500, [0, -100]), 0);
  assert.equal(recommendTopup(500, [Number.NaN, 2500]), 2500);
});

test('leads-per-top-up is consistent with the price it quoted', () => {
  const c = cost({ leadsPerMonth: 100 });
  assert.equal(c.leadsPerTopup, Math.floor(c.recommendedTopupPence / c.perLeadPence));
  assert.ok(c.leadsPerTopup > 0);
});
