import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTable } from '../credit/costs.ts';
import { priceFor } from '../credit/pricing.ts';
import { MODEL_UNITS } from './config.ts';
import { affordsLookUp, budgetFor, chargeLines, costOf, roundMaxTokens, unitsPriced, usageOf, ROUNDING_MARGIN, PROVIDER } from './budget.ts';

const table = seedTable();

test('the budget is the ceiling, or the balance when that is lower; under the floor there is none', () => {
  assert.equal(budgetFor({ ceilingPence: 25, floorPence: 10, spendableBasePence: 500, admin: false }), 25);
  assert.equal(budgetFor({ ceilingPence: 25, floorPence: 10, spendableBasePence: 12, admin: false }), 11.99);
  assert.equal(budgetFor({ ceilingPence: 25, floorPence: 10, spendableBasePence: 9.99, admin: false }), null);
  assert.equal(budgetFor({ ceilingPence: 3, floorPence: 0, spendableBasePence: 0, admin: false }), null);
  assert.equal(budgetFor({ ceilingPence: 25, floorPence: 10, spendableBasePence: 0, admin: true }), 25);
});

test('the chat models have every unit priced in the seed', () => {
  assert.ok(unitsPriced(table, MODEL_UNITS.quick));
  assert.ok(unitsPriced(table, MODEL_UNITS.full));
});

test('the charge is exactly what the meter will debit, line by line', () => {
  const usage = usageOf({ input_tokens: 1500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const lines = chargeLines(table, MODEL_UNITS.quick, usage, 5);
  assert.deepEqual(lines.map((l) => l.unit), ['haiku45_output_token', 'haiku45_input_token']);
  const meterSum = lines.reduce((n, l) => n + priceFor(table, PROVIDER, l.unit, l.quantity, 5).basePence, 0);
  const cost = costOf(table, MODEL_UNITS.quick, [usage], 5);
  assert.ok(Math.abs(cost.basePence - meterSum) < 1e-9);
  // about 0.8p for a typical quick answer
  assert.ok(cost.basePence > 0.7 && cost.basePence < 0.9, String(cost.basePence));
});

test('max_tokens keeps the worst case of a round inside the budget', () => {
  for (const [surface, prompt] of [['quick', 1500], ['full', 4000], ['full', 9000]] as const) {
    const units = MODEL_UNITS[surface];
    for (const budget of [1, 2, 3, 10, 25]) {
      for (const spent of [0, 0.5, 4]) {
        const max = roundMaxTokens({ table, units, markup: 5, budgetPence: budget, spentPence: spent, promptTokens: prompt, cap: 100_000 });
        if (max === 0) continue;
        // worst case: every prompt token written to the cache, every output token used
        const worst = costOf(table, units, [{ input: 0, output: max, cacheRead: 0, cacheWrite: prompt }], 5).basePence;
        assert.ok(spent + worst <= budget, `${surface} budget ${budget} spent ${spent}: ${spent + worst}`);
      }
    }
  }
});

test('a round that cannot afford a useful answer is not started', () => {
  assert.equal(roundMaxTokens({ table, units: MODEL_UNITS.full, markup: 5, budgetPence: 1, spentPence: 0, promptTokens: 4000, cap: 1200 }), 0);
  assert.equal(roundMaxTokens({ table, units: MODEL_UNITS.full, markup: 5, budgetPence: 25, spentPence: 0, promptTokens: 4000, cap: 1200 }), 1200);
  assert.ok(ROUNDING_MARGIN > 0);
});

test('without a price for the output the cost cannot be bounded, so nothing runs', () => {
  const empty = new Map();
  assert.equal(roundMaxTokens({ table: empty, units: MODEL_UNITS.quick, markup: 5, budgetPence: 3, spentPence: 0, promptTokens: 100, cap: 200 }), 0);
  assert.equal(unitsPriced(empty, MODEL_UNITS.quick), false);
});

test('usage takes only real positive numbers', () => {
  assert.deepEqual(usageOf({ input_tokens: 10, output_tokens: null, cache_read_input_tokens: -1 }), { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(usageOf(null), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test('the cached part of the prompt is priced at the read rate', () => {
  const full = MODEL_UNITS.full;
  const cold = roundMaxTokens({ table, units: full, markup: 5, budgetPence: 10, spentPence: 0, promptTokens: 8000, cap: 100_000 });
  const warm = roundMaxTokens({ table, units: full, markup: 5, budgetPence: 10, spentPence: 0, promptTokens: 8000, cachedTokens: 7000, cap: 100_000 });
  assert.ok(warm > cold);
  const worst = costOf(table, full, [{ input: 0, output: warm, cacheRead: 7000, cacheWrite: 1000 }], 5).basePence;
  assert.ok(worst <= 10, String(worst));
});

test('a look-up is only allowed when an answer can still follow it', () => {
  const full = MODEL_UNITS.full;
  const base = { table, units: full, markup: 5, spentPence: 0, promptTokens: 4500, cachedTokens: 0, room: 1200, resultTokens: 1700, finalTokens: 350 };
  assert.equal(affordsLookUp({ ...base, budgetPence: 25 }), true);
  assert.equal(affordsLookUp({ ...base, budgetPence: 10 }), false);
  // near the floor, a smaller round still leaves room
  assert.equal(affordsLookUp({ ...base, budgetPence: 10, room: 400 }), true);
});
