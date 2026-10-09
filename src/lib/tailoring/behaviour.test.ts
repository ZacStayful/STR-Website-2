import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandBelow, KEEP_MY_ANSWER, mayAsk, promptsFor, promptToShow, roundUpToFifty, type PassAnswer, type PromptState } from './behaviour.ts';
import { plainProfile, type Signal } from './profile.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const NOW = new Date('2026-09-28T10:00:00Z');
const TODAY = new Date('2026-09-28T07:00:00Z');
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
let n = 0;
const id = () => `d${++n}`;
const keep = (over: Partial<Signal> = {}): Signal => ({ dealId: id(), source: 'keep', at: AT, kind: 'sale', propertyKind: 'house', bedrooms: 3, area: 'NG', amount: 150_000, ...over });
const pass = (over: Partial<PassAnswer> = {}): PassAnswer => ({ dealId: id(), at: AT, kind: 'sale', propertyKind: 'house', bedrooms: 3, area: 'NG', amount: 150_000, ...over });
const times = <T,>(k: number, f: () => T): T[] => Array.from({ length: k }, f);
const profile = (g: Partial<MarketGoals>, signals: Signal[], over = {}) => plainProfile({ ...DEFAULT_GOALS, path: 'buy', ...g }, ['NG'], WIDTHS, { signals, answered: { property_type: real }, ...over });
const flatsOnly = { buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat' as const } };

test('nine houses kept on a flats-only profile: "I\'ve noticed", and what accepting does', () => {
  const p = profile(flatsOnly, [...times(9, () => keep()), ...times(11, () => keep({ propertyKind: 'flat' }))]);
  const [prompt] = promptsFor(p);
  assert.equal(prompt.question, 'type');
  assert.equal(prompt.text, 'I’ve noticed you’ve kept 9 houses, but you said flats only. Want me to include houses?');
  assert.equal(prompt.accept, 'Include houses');
  assert.equal(prompt.keep, KEEP_MY_ANSWER);
  assert.equal(prompt.change.kind === 'goals' && prompt.change.goals.buyer.propertyType, 'either');
});

test('fewer than 20 answers in all, fewer than 8 about the prompt, or under 80% agreeing: nothing is asked', () => {
  // 19 answers.
  assert.deepEqual(promptsFor(profile(flatsOnly, [...times(9, () => keep()), ...times(10, () => keep({ propertyKind: 'flat' }))])), []);
  // 20 answers, but only 7 about houses.
  assert.deepEqual(promptsFor(profile(flatsOnly, [...times(7, () => keep()), ...times(13, () => keep({ propertyKind: 'flat' }))])), []);
  // 10 house answers, 7 kept (70%).
  assert.deepEqual(promptsFor(profile(flatsOnly, [...times(7, () => keep()), ...times(10, () => keep({ propertyKind: 'flat' }))]), times(3, () => pass())), []);
  // 10 house answers, 8 kept (80%): asked.
  assert.equal(promptsFor(profile(flatsOnly, [...times(8, () => keep()), ...times(10, () => keep({ propertyKind: 'flat' }))]), times(2, () => pass()))[0]?.question, 'type');
  // Opens and Full analyses are not answers.
  assert.deepEqual(promptsFor(profile(flatsOnly, [...times(9, () => keep({ source: 'open' })), ...times(11, () => keep({ propertyKind: 'flat', source: 'analysis' }))])), []);
});

test('bedrooms, location, budget and kind each have their own Keep prompt', () => {
  const pad = (k: number, over: Partial<Signal> = {}) => times(k, () => keep({ propertyKind: 'flat', bedrooms: 2, ...over }));
  const beds = promptsFor(profile({ bedrooms: 2 }, [keep({ bedrooms: 3 }), ...times(8, () => keep({ bedrooms: 4 })), ...pad(11)]));
  assert.equal(beds[0].question, 'bedrooms');
  assert.equal(beds[0].text, 'I’ve noticed you’ve kept 9 deals that aren’t 2-bed, most of them 4+ bed. Want me to switch to 4 or more bedrooms?');
  const outside = [...times(9, () => keep({ area: 'LS' })), ...pad(11)];
  const where = promptsFor(profile({ where: 'areas' }, outside));
  assert.equal(where[0].question, 'location');
  assert.deepEqual(where[0].change, { kind: 'mode', criterion: 'location', to: 'nice' });
  // Already a nice-to-have: no Keep prompt about it.
  assert.ok(!promptsFor(profile({ where: 'areas' }, outside, { modes: { location: 'nice' } })).some((x) => x.question === 'location'));
  const budget = promptsFor(profile({ budget: '100-200' }, [...times(9, () => keep({ amount: 250_000 })), ...pad(11)]));
  assert.equal(budget[0].question, 'budget');
  const kind = promptsFor(profile({ dealTypes: ['buy_str'] }, [...times(9, () => keep({ kind: 'rent', amount: 900 })), ...pad(11)]));
  assert.equal(kind[0].question, 'kind');
  assert.equal(kind[0].text, 'I’ve noticed you’ve kept 9 rent-to-rent deals, but this profile doesn’t show them. Want me to show Rent-to-rent too?');
  assert.equal(kind[0].change.kind === 'goals' && kind[0].change.goals.sourcingKind, 'both');
});

test('Batch 25: kept rent-to-rent and passed every BRRR one: "stop showing BRRR?" — it removes BRRR and recomputes the search kind', () => {
  const p = profile({ dealTypes: ['brrr', 'r2r'], sourcingKind: 'both' }, times(12, () => keep({ kind: 'rent', amount: 900, dealType: 'r2r' })));
  const prompts = promptsFor(p, times(8, () => pass({ dealType: 'brrr' })));
  const drop = prompts.find((x) => x.question === 'kind_drop')!;
  assert.equal(drop.text, 'I’ve noticed you’ve kept 12 rent-to-rent deals and passed every BRRR one. Want me to stop showing BRRR?');
  assert.equal(drop.accept, 'Stop showing BRRR');
  assert.equal(drop.keep, KEEP_MY_ANSWER);
  assert.ok(drop.change.kind === 'goals');
  if (drop.change.kind === 'goals') {
    assert.deepEqual(drop.change.goals.dealTypes, ['r2r']);
    assert.equal(drop.change.goals.sourcingKind, 'rent');
  }
  // "most" at 80–99%: one BRRR kept, eight passed.
  const mixed = profile({ dealTypes: ['brrr', 'r2r'], sourcingKind: 'both' }, [...times(12, () => keep({ kind: 'rent', amount: 900, dealType: 'r2r' })), keep({ dealType: 'brrr' })]);
  assert.equal(promptsFor(mixed, times(8, () => pass({ dealType: 'brrr' }))).find((x) => x.question === 'kind_drop')?.text, 'I’ve noticed you’ve kept 12 rent-to-rent deals and passed most BRRR ones. Want me to stop showing BRRR?');
});

test('Batch 25: a profile with one deal type is never offered to drop it', () => {
  const p = profile({ dealTypes: ['r2r'], sourcingKind: 'rent' }, times(12, () => keep({ kind: 'rent', amount: 900, dealType: 'r2r' })));
  assert.ok(!promptsFor(p, times(10, () => pass({ kind: 'rent', amount: 900, dealType: 'r2r' }))).some((x) => x.question === 'kind_drop'));
});

test('Batch 25: passing most deals over the band\'s floor offers the next budget band down', () => {
  const p = profile({ budget: '200-350' }, [...times(4, () => keep({ amount: 180_000 })), ...times(8, () => keep({ amount: 120_000, propertyKind: 'flat' }))]);
  const band = promptsFor(p, [...times(8, () => pass({ amount: 300_000 })), pass({ amount: 260_000 })]).find((x) => x.question === 'budget_band')!;
  assert.equal(band.text, 'I’ve noticed you pass on every deal over £200k. Want me to change your budget to £100k–£200k?');
  assert.equal(band.change.kind === 'goals' && band.change.goals.budget, '100-200');
  assert.equal(bandBelow('u100'), null);
  assert.equal(bandBelow('500+'), '350-500');
  assert.equal(bandBelow('u200'), 'u100');
});

test('Batch 25: passing places over a rent offers that rent, rounded up to £50, as the maximum', () => {
  const rent = (amount: number) => ({ kind: 'rent' as const, amount, dealType: 'r2r' as const });
  const p = profile({ dealTypes: ['r2r'], sourcingKind: 'rent', maxRentPcm: 2_000 }, times(12, () => keep(rent(1_120))));
  const r = promptsFor(p, times(8, () => pass(rent(1_600)))).find((x) => x.question === 'max_rent')!;
  assert.equal(r.text, 'I’ve noticed you pass on every place over £1,150 a month. Want me to lower your maximum rent to £1,150?');
  assert.equal(r.change.kind === 'goals' && r.change.goals.maxRentPcm, 1_150);
  assert.equal(roundUpToFifty(1_201), 1_250);
  assert.equal(roundUpToFifty(1_200), 1_200);
  // Mostly passed above, but nothing kept below: not asked.
  assert.ok(!promptsFor(profile({ dealTypes: ['r2r'], sourcingKind: 'rent' }, times(12, () => keep(rent(1_800)))), times(8, () => pass(rent(1_900)))).some((x) => x.question === 'max_rent' && x.change.kind === 'goals' && x.change.goals.maxRentPcm! < 1_800));
});

test('Batch 25: said either, passed most flats and kept houses: "houses only?"', () => {
  const p = profile({ buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'either' } }, times(12, () => keep()));
  const t = promptsFor(p, times(8, () => pass({ propertyKind: 'flat' }))).find((x) => x.question === 'type_pass')!;
  assert.equal(t.text, 'I’ve noticed you pass on every flat. Want me to show houses only?');
  assert.equal(t.accept, 'Houses only');
  assert.equal(t.change.kind === 'goals' && t.change.goals.buyer.propertyType, 'house');
});

test('Batch 25: location a nice-to-have, outside passed and inside kept: "only my areas?" makes it a must-have', () => {
  const p = profile({ where: 'areas' }, times(12, () => keep({ area: 'NG' })), { modes: { location: 'nice' } });
  const l = promptsFor(p, times(8, () => pass({ area: 'LS' }))).find((x) => x.question === 'location_pass')!;
  assert.equal(l.accept, 'Only my areas');
  assert.deepEqual(l.change, { kind: 'mode', criterion: 'location', to: 'must' });
});

test('Batch 25: Passes never become the profile\'s signals', () => {
  const p = profile({ dealTypes: ['brrr', 'r2r'] }, times(12, () => keep({ kind: 'rent', amount: 900, dealType: 'r2r' })));
  const before = JSON.stringify(p.signals);
  promptsFor(p, times(8, () => pass({ dealType: 'brrr' })));
  assert.equal(JSON.stringify(p.signals), before);
  assert.ok(p.signals.every((s) => s.source === 'keep'));
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
  const p = profile({ ...flatsOnly, dealTypes: ['buy_str'] }, [...times(9, () => keep()), ...times(9, () => keep({ kind: 'rent', amount: 900 })), ...times(4, () => keep({ propertyKind: 'flat' }))]);
  assert.equal(promptToShow(p, [], NOW, TODAY)?.question, 'type');
  assert.equal(promptToShow(p, [{ question: 'type', lastShownAt: '2026-09-26T08:00:00Z', answeredAt: null, answer: null }], NOW, TODAY)?.question, 'kind');
  assert.equal(promptToShow(null, [], NOW, TODAY), null);
});

test('Batch 17: Keeps of a deal type the profile does not show ask to add it; accepting adds the type', () => {
  const brrr = () => keep({ dealType: 'brrr' });
  const p = profile({ dealTypes: ['buy_str'] }, [...times(9, brrr), ...times(11, () => keep({ propertyKind: 'flat' }))]);
  const kind = promptsFor(p).find((x) => x.question === 'kind')!;
  assert.equal(kind.text, 'I’ve noticed you’ve kept 9 BRRR projects, but this profile doesn’t show them. Want me to show BRRR too?');
  assert.equal(kind.accept, 'Show BRRR too');
  assert.equal(kind.keep, KEEP_MY_ANSWER);
  assert.ok(kind.change.kind === 'goals');
  if (kind.change.kind === 'goals') {
    assert.deepEqual(kind.change.goals.dealTypes, ['buy_str', 'brrr']);
    assert.equal(kind.change.goals.sourcingKind, 'sale');
  }
  // Every type already shown: nothing to ask.
  assert.equal(promptsFor(profile({ dealTypes: ['buy_str', 'brrr', 'r2r'] }, [...times(9, brrr), ...times(11, () => keep({ propertyKind: 'flat' }))])).some((x) => x.question === 'kind'), false);
});
