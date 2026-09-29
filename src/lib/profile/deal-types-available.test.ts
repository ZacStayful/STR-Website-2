import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABLE_DEAL_TYPES, COMING_SOON_DEAL_TYPES, DEAL_TYPES, DEAL_TYPE_LONG_LABELS, dealTypesFor, describeTypes, kindsFor, typesShown, withAddedType } from './deal-types.ts';
import { applyAnswer, dealTypesFromAnswer, emptyAnswers, questionById, ALL_DEAL_TYPES } from './questions.ts';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals.ts';
import { typesFromForm, criteriaForNewProfile } from '../profiles/rules.ts';
import { baseSlots, mixSlots, fillMix } from '../today/mix.ts';
import { browseFilters, parseDealFilters, typeClauseFor, typesParam } from '../marketplace/grid.ts';
import { kindsOf } from '../sourcing-demand/demand.ts';

// Batch 17, Part 4 (29 Sep): Buy to let (long-term tenants) is declared and
// shown "Coming soon"; no profile can hold it, "All of them" never includes
// it, and nothing sources, ranks or shows it until Batch 28 adds it to
// AVAILABLE_DEAL_TYPES.

test('the four declared types in the question’s order; Buy to let is the one coming soon', () => {
  assert.deepEqual([...DEAL_TYPES], ['buy_str', 'brrr', 'r2r', 'btl']);
  assert.deepEqual([...AVAILABLE_DEAL_TYPES], ['buy_str', 'brrr', 'r2r']);
  assert.deepEqual([...COMING_SOON_DEAL_TYPES], ['btl']);
  assert.equal(DEAL_TYPE_LONG_LABELS.buy_str, 'Short-let (buy and run it as a holiday let)');
  assert.equal(DEAL_TYPE_LONG_LABELS.btl, 'Buy to let (long-term tenants)');
  // 'hmo' is reserved in a comment only: not a type.
  assert.ok(!(DEAL_TYPES as readonly string[]).includes('hmo'));
});

test('the question shows Buy to let greyed out, "Coming soon"; the others can be ticked', () => {
  const q = questionById('deal_types')!;
  const options = typeof q.options === 'function' ? q.options(emptyAnswers(DEFAULT_GOALS, null, [])) : q.options!;
  assert.deepEqual(options.map((o) => o.value), ['buy_str', 'brrr', 'r2r', 'btl', ALL_DEAL_TYPES]);
  assert.equal(options.find((o) => o.value === 'btl')!.soon, 'Coming soon');
  assert.ok(options.filter((o) => o.value !== 'btl').every((o) => !o.soon));
});

test('a profile cannot save Buy to let while it is unavailable, however it is posted', () => {
  const a = emptyAnswers(DEFAULT_GOALS, null, []);
  const only = applyAnswer('deal_types', ['btl'], a);
  assert.equal(only.ok, false);
  if (!only.ok) assert.match(only.error, /coming soon/i);
  const mixed = applyAnswer('deal_types', ['buy_str', 'btl'], a);
  assert.ok(mixed.ok);
  if (mixed.ok) assert.deepEqual(mixed.answers.goals.dealTypes, ['buy_str'], 'the coming-soon type is dropped, the rest kept');
  // Stored, it is dropped when read; the new-profile form drops it; the pick feedback never adds it.
  assert.deepEqual(parseMarketGoals({ ...DEFAULT_GOALS, dealTypes: ['btl', 'r2r'] })?.dealTypes, ['r2r']);
  assert.equal(parseMarketGoals({ ...DEFAULT_GOALS, dealTypes: ['btl'] })?.dealTypes, null);
  assert.deepEqual(typesFromForm(['btl', 'brrr']), ['brrr']);
  assert.equal(criteriaForNewProfile({ ...DEFAULT_GOALS, dealTypes: null }, ['btl'])?.dealTypes, null, 'a form with only Buy to let: the copy as it is (the gate asks)');
  assert.equal(withAddedType({ goals: DEFAULT_GOALS, about: null }, 'btl'), null);
  // Held somehow: never read as a chosen type.
  assert.deepEqual(dealTypesFor({ goals: { ...DEFAULT_GOALS, dealTypes: ['btl'] }, about: null }), []);
  assert.deepEqual(typesShown({ goals: { ...DEFAULT_GOALS, dealTypes: ['btl'] }, about: null }), ['buy_str', 'r2r']);
});

test('"All of them" is every available type and never Buy to let', () => {
  assert.deepEqual(dealTypesFromAnswer(ALL_DEAL_TYPES), ['buy_str', 'brrr', 'r2r']);
  assert.deepEqual(dealTypesFromAnswer([ALL_DEAL_TYPES, 'btl']), ['buy_str', 'brrr', 'r2r']);
  const all = applyAnswer('deal_types', [ALL_DEAL_TYPES], emptyAnswers(DEFAULT_GOALS, null, []));
  assert.ok(all.ok);
  if (all.ok) assert.ok(!all.answers.goals.dealTypes!.includes('btl'));
  assert.equal(describeTypes(['buy_str', 'brrr', 'r2r']), 'All of them');
});

test('Today’s mix, Browse’s defaults and the demand-led kinds only ever see the available types', () => {
  const withSoon = ['buy_str', 'brrr', 'r2r', 'btl'] as const;
  assert.deepEqual(baseSlots([...withSoon]), { buy_str: 2, brrr: 1, r2r: 2 });
  assert.equal(mixSlots([...withSoon], { btl: 30 }).btl, undefined);
  assert.deepEqual(fillMix(['btl'], { btl: 5 }, { btl: ['x1', 'x2'] }), [], 'a coming-soon type is never on the day');
  assert.deepEqual(typesParam('btl'), []);
  assert.deepEqual(typesParam('all'), ['buy_str', 'brrr', 'r2r']);
  assert.deepEqual(browseFilters(parseDealFilters({}), false, ['buy_str', 'btl']).types, ['buy_str']);
  // A filter naming only Buy to let matches nothing: it is never a type to show.
  assert.deepEqual(typeClauseFor(['btl'], true), { none: true });
  assert.deepEqual(typeClauseFor(['btl', 'r2r'], true), { kind: 'rent' });
  assert.equal(kindsFor(['btl']), 'both', 'nothing available chosen: what an unanswered profile searches');
  assert.deepEqual(kindsOf({ ...DEFAULT_GOALS, dealTypes: ['btl'] as never }), ['sale', 'rent']);
});
