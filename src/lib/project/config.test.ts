import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECT_ALLOWANCE,
  DEFAULT_PROJECT_CEILING,
  DEFAULT_PROJECT_CHECKS,
  DEFAULT_PROJECT_COSTS,
  DEFAULT_PROJECT_RATES,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_PROJECT_VALUE,
  parseProjectAllowance,
  parseProjectCeiling,
  parseProjectChecks,
  parseProjectCosts,
  parseProjectRates,
  parseProjectSettings,
  parseProjectValue,
} from './config.ts';
import { compareCandidates, priceToAreaMedian, rankCandidates } from './rank.ts';

test('the decided figures are the defaults (Zac’s BRRR guide, 28 Sep 2026)', () => {
  const r = DEFAULT_PROJECT_RATES;
  assert.deepEqual(
    [r.waste, r.rewire, r.boiler, r.radiator, r.waterTank, r.pipework, r.bathroom, r.plaster, r.skirting, r.paint, r.kitchen, r.carpet, r.roof, r.window, r.outsideDoor, r.internalDoor, r.damp],
    [300, 4_500, 2_500, 300, 2_500, 500, 2_000, 500, 650, 350, 4_000, 250, 3_000, 400, 600, 300, 350],
  );
  assert.deepEqual(r.kitchenFactors, { small: 1, big: 1.5, extra_big: 2 });
  assert.equal(r.contingencyPct, 10);
  assert.deepEqual(DEFAULT_PROJECT_VALUE, { visibleMultiplier: 2, hiddenMultiplier: 1, minUplift: 15_000, minUpliftPctOfValue: 10, refinancePct: 75 });
  assert.equal(DEFAULT_PROJECT_COSTS.buyingCosts, 2_500);
  assert.equal(DEFAULT_PROJECT_COSTS.buyingCostsBridging, 3_500);
  assert.equal(DEFAULT_PROJECT_CHECKS.enabled, false, 'the hold starts off');
  assert.deepEqual(DEFAULT_PROJECT_ALLOWANCE, { photoChecks: 5, capPence: 250 });
});

test('a missing, bad or out-of-bounds field keeps its default', () => {
  assert.deepEqual(parseProjectRates(null), DEFAULT_PROJECT_RATES);
  assert.deepEqual(parseProjectRates('not json'), DEFAULT_PROJECT_RATES);
  const r = parseProjectRates({ paint: 400, kitchen: -1, contingencyPct: 80, kitchenFactors: { big: 1.75, small: 'x' } });
  assert.equal(r.paint, 400);
  assert.equal(r.kitchen, DEFAULT_PROJECT_RATES.kitchen);
  assert.equal(r.contingencyPct, DEFAULT_PROJECT_RATES.contingencyPct);
  assert.deepEqual(r.kitchenFactors, { small: 1, big: 1.75, extra_big: 2 });
  assert.equal(parseProjectValue(JSON.stringify({ minUplift: 20_000 })).minUplift, 20_000);
  assert.equal(parseProjectValue({ refinancePct: 150 }).refinancePct, 75);
});

test('ceiling radii must rise with one weight each, or both defaults stay', () => {
  assert.deepEqual(parseProjectCeiling({ radiiMiles: [0.5, 1], weights: [1, 0.5] }).radiiMiles, [0.5, 1]);
  assert.deepEqual(parseProjectCeiling({ radiiMiles: [1, 0.5], weights: [1, 0.5] }).radiiMiles, DEFAULT_PROJECT_CEILING.radiiMiles);
  assert.deepEqual(parseProjectCeiling({ radiiMiles: [0.5, 1], weights: [1] }).weights, DEFAULT_PROJECT_CEILING.weights);
  assert.equal(parseProjectCeiling({ minSales: 20, targetSales: 8 }).minSales, 8, 'the minimum never exceeds the target');
});

test('switches and the light/full lines', () => {
  assert.equal(parseProjectChecks({ enabled: true }).enabled, true);
  assert.equal(parseProjectChecks({ enabled: 'yes' }).enabled, false);
  assert.equal(parseProjectChecks({ effort: 'max' }).effort, 'medium');
  assert.equal(parseProjectCosts({ arrangementFee: false }).arrangementFee, false);
  assert.equal(parseProjectCosts({ lightBelowWorks: 20_000 }).lightBelowWorks, 15_000, 'the light line never sits above the full one');
});

test('the allowance rides in Batch 16’s deal_checks row', () => {
  assert.deepEqual(parseProjectAllowance({ perDay: 20, projectPhotoChecks: 1, projectCapPence: 40 }), { photoChecks: 1, capPence: 40 });
  assert.deepEqual(parseProjectAllowance({ perDay: 20 }), DEFAULT_PROJECT_ALLOWANCE);
  assert.deepEqual(parseProjectSettings({}), DEFAULT_PROJECT_SETTINGS);
});

test('candidates in order: best case, wording, motivation, then cheaper for the area', () => {
  const base = { bestCaseValueAdded: 20_000, wordingScore: 3, motivationScore: 40, priceToAreaMedian: 0.8 };
  const list = [
    { id: 'cheap', key: { ...base, priceToAreaMedian: 0.6 } },
    { id: 'best', key: { ...base, bestCaseValueAdded: 22_000 } },
    { id: 'words', key: { ...base, wordingScore: 6 } },
    { id: 'plain', key: base },
    { id: 'motivated', key: { ...base, motivationScore: 70 } },
  ];
  assert.deepEqual(rankCandidates(list).map((c) => c.id), ['best', 'words', 'motivated', 'cheap', 'plain']);
  assert.ok(compareCandidates({ ...base, motivationScore: null }, base) > 0);
  assert.equal(priceToAreaMedian(150_000, 3, 62_500), 0.8);
  assert.equal(priceToAreaMedian(150_000, null, null), null);
});
