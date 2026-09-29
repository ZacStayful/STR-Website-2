import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayAsk, promptsFor, promptToShow, type PromptState } from './behaviour.ts';
import { plainProfile, type Signal } from './profile.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const NOW = new Date('2026-09-28T10:00:00Z');
const TODAY = new Date('2026-09-28T07:00:00Z');
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
const keep = (over: Partial<Signal>): Signal => ({ dealId: Math.random().toString(36), source: 'keep', at: AT, kind: 'sale', propertyKind: 'house', bedrooms: 3, area: 'NG', amount: 150_000, ...over });
const profile = (g: Partial<MarketGoals>, signals: Signal[], over = {}) => plainProfile({ ...DEFAULT_GOALS, path: 'buy', ...g }, ['NG'], WIDTHS, { signals, answered: { property_type: real }, ...over });

test('four houses kept on a flats-only profile: the prompt, and what accepting does', () => {
  const p = profile({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' } }, [keep({}), keep({}), keep({}), keep({})]);
  const [prompt] = promptsFor(p);
  assert.equal(prompt.question, 'type');
  assert.equal(prompt.text, 'You’ve kept 4 houses but said flats only. Update your profile?');
  assert.equal(prompt.accept, 'Include houses');
  assert.equal(prompt.keep, 'Keep flats only');
  assert.equal(prompt.change.kind === 'goals' && prompt.change.goals.buyer.propertyType, 'either');
});

test('fewer than three Keeps, or opens rather than Keeps, ask nothing', () => {
  assert.deepEqual(promptsFor(profile({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' } }, [keep({}), keep({})])), []);
  assert.deepEqual(promptsFor(profile({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' } }, [keep({ source: 'open' }), keep({ source: 'open' }), keep({ source: 'analysis' })])), []);
});

test('bedrooms, location, budget and kind each have their own prompt', () => {
  const beds = promptsFor(profile({ bedrooms: 2 }, [keep({ bedrooms: 4 }), keep({ bedrooms: 5 }), keep({ bedrooms: 3 })]));
  assert.equal(beds[0].question, 'bedrooms');
  assert.equal(beds[0].accept, 'Switch to 4 or more bedrooms');
  const where = promptsFor(profile({ where: 'areas' }, [keep({ area: 'LS' }), keep({ area: 'M' }), keep({ area: 'YO' })]));
  assert.equal(where[0].question, 'location');
  assert.deepEqual(where[0].change, { kind: 'mode', criterion: 'location' });
  // Already a nice-to-have: nothing to ask.
  assert.deepEqual(promptsFor(profile({ where: 'areas' }, [keep({ area: 'LS' }), keep({ area: 'M' }), keep({ area: 'YO' })], { modes: { location: 'nice' } })), []);
  const budget = promptsFor(profile({ budget: 'u200' }, [keep({ amount: 250_000 }), keep({ amount: 300_000 }), keep({ amount: 210_000 })]));
  assert.equal(budget[0].question, 'budget');
  const kind = promptsFor(profile({ sourcingKind: 'sale' }, [keep({ kind: 'rent' }), keep({ kind: 'rent' }), keep({ kind: 'rent' })]));
  assert.equal(kind[0].question, 'kind');
  assert.equal(kind[0].change.kind === 'goals' && kind[0].change.goals.sourcingKind, 'both');
});

test('asked once a week at most; after "keep my answer", not for 30 days; shown today stays until answered', () => {
  const s = (over: Partial<PromptState>): PromptState => ({ question: 'type', lastShownAt: null, answeredAt: null, answer: null, ...over });
  assert.equal(mayAsk(undefined, NOW, TODAY), true);
  assert.equal(mayAsk(s({ lastShownAt: '2026-09-28T08:00:00Z' }), NOW, TODAY), true, 'shown this morning: still today’s');
  assert.equal(mayAsk(s({ lastShownAt: '2026-09-28T08:00:00Z', answeredAt: '2026-09-28T08:05:00Z', answer: 'accepted' }), NOW, TODAY), false);
  assert.equal(mayAsk(s({ lastShownAt: '2026-09-25T08:00:00Z' }), NOW, TODAY), false, 'three days ago');
  assert.equal(mayAsk(s({ lastShownAt: '2026-09-20T08:00:00Z' }), NOW, TODAY), true, 'eight days ago');
  assert.equal(mayAsk(s({ lastShownAt: '2026-09-10T08:00:00Z', answeredAt: '2026-09-10T08:01:00Z', answer: 'dismissed' }), NOW, TODAY), false, 'kept their answer 18 days ago');
  assert.equal(mayAsk(s({ lastShownAt: '2026-08-20T08:00:00Z', answeredAt: '2026-08-20T08:01:00Z', answer: 'dismissed' }), NOW, TODAY), true);
});

test('one prompt a visit: the first that may be asked', () => {
  const p = profile({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' }, sourcingKind: 'sale' }, [keep({}), keep({}), keep({}), keep({ kind: 'rent' }), keep({ kind: 'rent' }), keep({ kind: 'rent' })]);
  assert.equal(promptToShow(p, [], NOW, TODAY)?.question, 'type');
  assert.equal(promptToShow(p, [{ question: 'type', lastShownAt: '2026-09-26T08:00:00Z', answeredAt: null, answer: null }], NOW, TODAY)?.question, 'kind');
  assert.equal(promptToShow(null, [], NOW, TODAY), null);
});

test('Batch 17: Keeps of a deal type the profile does not show ask to add it; accepting adds the type', () => {
  const brrr = () => keep({ dealType: 'brrr' });
  const p = profile({ dealTypes: ['buy_let'] }, [brrr(), brrr(), brrr(), keep({ kind: 'rent' })]);
  const kind = promptsFor(p).find((x) => x.question === 'kind')!;
  assert.equal(kind.text, 'You’ve kept 3 BRRR projects but this profile doesn’t show them. Show BRRR too?');
  assert.equal(kind.accept, 'Show BRRR too');
  assert.equal(kind.keep, 'Keep to Buy and let');
  assert.ok(kind.change.kind === 'goals');
  if (kind.change.kind === 'goals') {
    assert.deepEqual(kind.change.goals.dealTypes, ['buy_let', 'brrr']);
    assert.equal(kind.change.goals.sourcingKind, 'sale');
  }
  // Every type already shown: nothing to ask.
  assert.equal(promptsFor(profile({ dealTypes: ['buy_let', 'brrr', 'r2r'] }, [brrr(), brrr(), brrr()])).some((x) => x.question === 'kind'), false);
});
