import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_COST_SEED } from '../../credit/costs.ts';
import { GAP_DRAFT_MODEL, GAP_GROUP_MODEL } from '../config.ts';
import { catalogueForDrafting, draftCandidates, fitsCap, MODEL_UNITS, uniqueSlug, usagePence, worstCasePence, type GapRow } from './plan.ts';
import { schemaSnapshot } from '../test-fixtures.ts';

const price = (unit: string) => UNIT_COST_SEED.find((r) => r.provider === 'anthropic' && r.unit === unit)?.unitCostPence ?? Number.NaN;

test('both models have every unit row they are metered at', () => {
  for (const model of [GAP_GROUP_MODEL, GAP_DRAFT_MODEL]) {
    for (const unit of Object.values(MODEL_UNITS[model])) assert.ok(Number.isFinite(price(unit)) && price(unit) > 0, `${model} ${unit}`);
  }
});

test('the prices are the ones in the brief, at 79p a dollar', () => {
  const s = MODEL_UNITS[GAP_DRAFT_MODEL];
  // Sonnet 5.5: $2 / $10, cache read $0.20 per million tokens.
  assert.ok(Math.abs(usagePence(s, { input_tokens: 1_000_000 }, price) - 158) < 1e-6);
  assert.ok(Math.abs(usagePence(s, { output_tokens: 1_000_000 }, price) - 790) < 1e-6);
  assert.ok(Math.abs(usagePence(s, { cache_read_input_tokens: 1_000_000 }, price) - 15.8) < 1e-6);
  const h = MODEL_UNITS[GAP_GROUP_MODEL];
  // Haiku 4.5: $1 / $5, cache read $0.10.
  assert.ok(Math.abs(usagePence(h, { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }, price) - (79 + 395 + 7.9)) < 1e-6);
});

test('worst case is never below the real cost; the cap refuses a call that could pass it', () => {
  const s = MODEL_UNITS[GAP_DRAFT_MODEL];
  const worst = worstCasePence(s, 12_000, 700, price);
  assert.ok(worst >= usagePence(s, { input_tokens: 400, cache_read_input_tokens: 11_600, output_tokens: 700 }, price));
  assert.ok(worst >= usagePence(s, { cache_creation_input_tokens: 12_000, output_tokens: 700 }, price));
  assert.equal(fitsCap(1490, 9, 1500), true);
  assert.equal(fitsCap(1495, 9, 1500), false);
  assert.equal(fitsCap(0, 1, 0), false, 'a cap of 0 stops the model calls');
});

test('draft candidates: open, unanswered, not given up on, most asked first', () => {
  const g = (o: Partial<GapRow>): GapRow => ({ id: 'x', label: 'L', status: 'open', entry_id: null, asked: 1, draft_attempts: 0, last_asked_at: null, ...o });
  const out = draftCandidates([g({ id: 'a', asked: 2 }), g({ id: 'b', asked: 5 }), g({ id: 'c', status: 'rejected', asked: 9 }), g({ id: 'd', entry_id: 'e', asked: 9 }), g({ id: 'f', draft_attempts: 2, asked: 9 })], 5);
  assert.deepEqual(out.map((x) => x.id), ['b', 'a']);
  assert.equal(draftCandidates([g({ id: 'a' })], 0).length, 0);
});

test('slugs and the catalogue', () => {
  assert.equal(uniqueSlug('Can I pause my plan?', new Set(['can_i_pause_my_plan'])), 'can_i_pause_my_plan_2');
  const cat = catalogueForDrafting(schemaSnapshot());
  assert.match(cat, /\{full_analysis_cost\}: .* \(now: £4\)/);
  assert.doesNotMatch(cat, /\{balance\}/, 'member values are never offered to a draft');
});
