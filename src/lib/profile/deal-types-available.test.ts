import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABLE_DEAL_TYPES, COMING_SOON_DEAL_TYPES, DEAL_TYPES, DEAL_TYPE_LONG_LABELS, dealFitsTypes, dealTypeFor, dealTypeOf, dealTypesFor, dealTypesOf, describeTypes, kindsFor, typesShown, withAddedType } from './deal-types.ts';
import { applyAnswer, dealTypesFromAnswer, emptyAnswers, questionById, ALL_DEAL_TYPES } from './questions.ts';
import { DEFAULT_GOALS, parseMarketGoals } from '../market/goals.ts';
import { typesFromForm } from '../profiles/rules.ts';
import { baseSlots, fillMix } from '../today/mix.ts';
import { browseFilters, parseDealFilters, typeClauseFor, typesParam } from '../marketplace/grid.ts';
import { kindsOf } from '../sourcing-demand/demand.ts';

// Batch 28 (Batch 17 declared it "Coming soon"): Buy to let (long-term
// tenants) is a type a profile can hold. A profile that chose "All of them"
// before it existed holds the three older types and sees none until it taps.

test('the four types in the question’s order, all of them available; nothing is coming soon', () => {
  assert.deepEqual([...DEAL_TYPES], ['buy_str', 'brrr', 'r2r', 'btl']);
  assert.deepEqual([...AVAILABLE_DEAL_TYPES], ['buy_str', 'brrr', 'r2r', 'btl']);
  assert.deepEqual([...COMING_SOON_DEAL_TYPES], []);
  assert.equal(DEAL_TYPE_LONG_LABELS.btl, 'Buy to let (long-term tenants)');
  // 'hmo' is reserved in a comment only: not a type.
  assert.ok(!(DEAL_TYPES as readonly string[]).includes('hmo'));
});

test('the question offers Buy to let like the others, and a profile can save it', () => {
  const q = questionById('deal_types')!;
  const options = typeof q.options === 'function' ? q.options(emptyAnswers(DEFAULT_GOALS, null, [])) : q.options!;
  assert.deepEqual(options.map((o) => o.value), ['buy_str', 'brrr', 'r2r', 'btl', ALL_DEAL_TYPES]);
  assert.ok(options.every((o) => !o.soon));
  const only = applyAnswer('deal_types', ['btl'], emptyAnswers(DEFAULT_GOALS, null, []));
  assert.ok(only.ok);
  if (only.ok) assert.deepEqual(only.answers.goals.dealTypes, ['btl']);
  assert.deepEqual(parseMarketGoals({ ...DEFAULT_GOALS, dealTypes: ['btl', 'r2r'] })?.dealTypes, ['r2r', 'btl']);
  assert.deepEqual(typesFromForm(['btl', 'brrr']), ['brrr', 'btl']);
  assert.deepEqual(withAddedType({ goals: { ...DEFAULT_GOALS, dealTypes: ['buy_str'] }, about: null }, 'btl')?.dealTypes, ['buy_str', 'btl']);
  assert.equal(kindsFor(['btl']), 'sale');
  assert.deepEqual(kindsOf({ ...DEFAULT_GOALS, dealTypes: ['btl'] }), ['sale']);
});

test('"All of them" now ticks all four; a profile that chose it before holds the three and gets Buy to let only after a tap', () => {
  assert.deepEqual(dealTypesFromAnswer(ALL_DEAL_TYPES), ['buy_str', 'brrr', 'r2r', 'btl']);
  assert.equal(describeTypes(['buy_str', 'brrr', 'r2r', 'btl']), 'All of them');
  const before = { goals: { ...DEFAULT_GOALS, dealTypes: ['buy_str', 'brrr', 'r2r'] as const }, about: null };
  const held = { goals: { ...before.goals, dealTypes: [...before.goals.dealTypes] }, about: null };
  assert.deepEqual(dealTypesFor(held), ['buy_str', 'brrr', 'r2r'], 'stored as the explicit list: no Buy to let');
  assert.equal(describeTypes(dealTypesFor(held)), 'Short-let · BRRR · Rent-to-rent');
  assert.deepEqual(baseSlots(dealTypesFor(held)), { buy_str: 2, brrr: 1, r2r: 2 }, 'their day keeps its mix');
  assert.deepEqual(withAddedType(held, 'btl')?.dealTypes, ['buy_str', 'brrr', 'r2r', 'btl'], 'the tap');
  assert.deepEqual(typesShown({ goals: { ...DEFAULT_GOALS, dealTypes: null }, about: null }), ['buy_str', 'r2r'], 'an unanswered profile is shown no Buy to let either');
});

// ─── The leak guard: a buy-to-let-only row is never a short-let deal ──

const SHORT_LET = { kind: 'sale', band: 'qualified', btl_pass: false, project: null };
const BTL_ONLY = { kind: 'sale', band: 'unqualified', btl_pass: true, project: null };
const BOTH = { kind: 'sale', band: 'qualified', btl_pass: true, project: null };
const STALE = { kind: 'sale', band: 'unqualified', btl_pass: false, project: null };
const RENTAL = { kind: 'rent', band: 'qualified', btl_pass: false, project: null };

test('a row’s types: a buy-to-let-only sale is Buy to let and never Short-let, even with its lens being redone', () => {
  assert.deepEqual(dealTypesOf(SHORT_LET), ['buy_str']);
  assert.deepEqual(dealTypesOf(BTL_ONLY), ['btl']);
  assert.deepEqual(dealTypesOf(BOTH), ['buy_str', 'btl']);
  assert.deepEqual(dealTypesOf(STALE), ['btl'], 'repriced, figures being redone: still never Short-let');
  assert.deepEqual(dealTypesOf(RENTAL), ['r2r']);
  assert.equal(dealTypeOf(BTL_ONLY), 'btl');
  assert.equal(dealTypeOf(BOTH), 'buy_str');
  // A reader from before Batch 28 (no band selected) keeps its old reading.
  assert.equal(dealTypeOf({ kind: 'sale' }), 'buy_str');
});

test('a deal that is two types is shown once, as the first one the member chose (Q14)', () => {
  assert.equal(dealTypeFor(BOTH, ['btl']), 'btl');
  assert.equal(dealTypeFor(BOTH, ['buy_str', 'btl']), 'buy_str');
  assert.equal(dealTypeFor(BOTH, ['r2r']), 'buy_str', 'none chosen: its own type');
  assert.equal(dealFitsTypes(BTL_ONLY, ['buy_str', 'brrr', 'r2r']), false, 'never for a profile without Buy to let');
  assert.equal(dealFitsTypes(BOTH, ['buy_str']), true);
  assert.equal(dealFitsTypes(STALE, ['buy_str', 'brrr', 'r2r', 'btl']), true);
});

test('the query clauses: Short-let needs the short-let band, so a buy-to-let-only row never matches it', () => {
  assert.deepEqual(typeClauseFor(['buy_str'], true), { kind: 'sale', project: 'null', band: 'qualified' });
  assert.deepEqual(typeClauseFor(['btl'], true), { kind: 'sale', btl: true });
  assert.deepEqual(typeClauseFor(['buy_str', 'brrr', 'r2r'], true), { or: 'kind.eq.rent,and(kind.eq.sale,band.eq.qualified),project.not.is.null' }, 'an "All" profile from before: no buy-to-let-only row');
  assert.deepEqual(typeClauseFor(['buy_str', 'brrr', 'r2r', 'btl'], true), { or: 'kind.eq.rent,and(kind.eq.sale,band.eq.qualified),project.not.is.null,and(kind.eq.sale,btl_pass.is.true)' }, 'every type, but never a row whose lens is being redone');
  assert.deepEqual(typeClauseFor([], true), typeClauseFor(['buy_str', 'brrr', 'r2r', 'btl'], true));
  assert.deepEqual(typeClauseFor(['btl', 'r2r'], true), { or: 'kind.eq.rent,and(kind.eq.sale,btl_pass.is.true)' });
  // Before the schema section: no buy-to-let rows, and the band is no filter yet.
  assert.deepEqual(typeClauseFor(['btl'], true, false, false), { none: true });
  assert.deepEqual(typeClauseFor(['btl', 'r2r'], true, false, false), { kind: 'rent' });
  assert.equal(typeClauseFor(['buy_str', 'brrr', 'r2r'], true, false, false), null);
});

test('Browse, the URL and the day all see Buy to let as a type', () => {
  assert.deepEqual(typesParam('btl'), ['btl']);
  assert.deepEqual(typesParam('all'), ['buy_str', 'brrr', 'r2r', 'btl']);
  assert.deepEqual(browseFilters(parseDealFilters({}), false, ['buy_str', 'btl']).types, ['buy_str', 'btl']);
  assert.deepEqual(browseFilters(parseDealFilters({}), false, ['buy_str', 'brrr', 'r2r']).types, ['buy_str', 'brrr', 'r2r'], 'three of four is a filter now, not "every type"');
  assert.deepEqual(fillMix(['btl'], { btl: 5 }, { btl: ['x1', 'x2'], buy_str: ['s1'] }), ['x1', 'x2']);
  assert.deepEqual(fillMix(['buy_str', 'brrr', 'r2r'], { buy_str: 2, brrr: 1, r2r: 2 }, { btl: ['x1'], buy_str: ['s1'] }), ['s1'], 'Buy to let never on a day that did not choose it');
});
