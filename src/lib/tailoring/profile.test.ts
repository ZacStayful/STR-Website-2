import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMarks, parseFilterModes, plainProfile, realAnswer, usesTailoring, asked, type Signal } from './profile.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import type { AnsweredMap } from '../profile/state.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
const shrug = { at: AT, notSure: true };
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over });

test('filter modes: only switchable criteria and must / nice survive', () => {
  assert.deepEqual(parseFilterModes({ bedrooms: 'must', budget: 'nice', motivation: 'must', nonsense: 'must', type: 'maybe' }), { bedrooms: 'must', budget: 'nice' });
  assert.deepEqual(parseFilterModes(null), {});
  assert.deepEqual(parseFilterModes(['bedrooms']), {});
  assert.deepEqual(parseFilterModes('must'), {});
});

test('marks: the profile keeps its own, the member’s shared About-you answers win', () => {
  const profile: AnsweredMap = { budget: real, deals_done: shrug, bedrooms: real };
  const member: AnsweredMap = { deals_done: real, risk: real, budget: shrug };
  const merged = mergeMarks(profile, member);
  assert.deepEqual(merged, { budget: real, bedrooms: real, deals_done: real, risk: real });
});

test('a member with no new answers is not tailored', () => {
  assert.equal(usesTailoring(null), false);
  assert.equal(usesTailoring(plainProfile(null, [], WIDTHS)), false);
  // The welcome questions and the mandatory quiz answers are what Today already read.
  const welcome = plainProfile(goals({ budget: '200-350', where: 'areas' }), ['NG'], WIDTHS, { answered: { roles: real, where: real, budget: real, motivated_sellers: real } });
  assert.equal(usesTailoring(welcome), false);
  // "Not sure" is an answer that changes nothing.
  assert.equal(usesTailoring(plainProfile(goals(), [], WIDTHS, { answered: { deals_done: shrug, cash_available: shrug } })), false);
});

test('any new real answer, a switch, bedrooms or something liked makes a profile tailored', () => {
  assert.equal(usesTailoring(plainProfile(goals(), [], WIDTHS, { answered: { deals_done: real } })), true);
  assert.equal(usesTailoring(plainProfile(goals(), [], WIDTHS, { modes: { budget: 'nice' } })), true);
  assert.equal(usesTailoring(plainProfile(goals({ bedrooms: 3 }), [], WIDTHS)), true, 'the pre-quiz bedrooms answer now applies');
  const liked: Signal = { dealId: 'd1', source: 'keep', at: AT, kind: 'sale', propertyKind: 'house', bedrooms: 3, area: 'NG', amount: 180_000 };
  assert.equal(usesTailoring(plainProfile(goals(), [], WIDTHS, { signals: [liked] })), true);
});

test('real answers and the questions a profile is asked', () => {
  const p = plainProfile(goals({ path: 'r2r' }), [], WIDTHS, { answered: { r2r_min_profit: real, min_profit: shrug } });
  assert.equal(realAnswer(p, 'r2r_min_profit'), true);
  assert.equal(realAnswer(p, 'min_profit'), false);
  assert.equal(realAnswer(p, 'payback'), false);
  assert.equal(asked(p, 'setup_budget'), true);
  assert.equal(asked(p, 'cash_available'), false, 'a buyer question is not asked on the rent-to-rent path');
  assert.equal(asked(plainProfile(goals({ path: null }), [], WIDTHS), 'cash_available'), true, 'before the quiz, whatever is stored counts');
  assert.equal(asked(plainProfile(null, [], WIDTHS), 'bedrooms'), false);
});
