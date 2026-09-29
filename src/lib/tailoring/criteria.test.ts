import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCriteria, checksFor, criterionForQuestion, factsFromRow, judge, judgeDeal, memberFigures, modeOf, mustHaveTest, tenureOf, wantsFor, type DealFacts } from './criteria.ts';
import { plainProfile, type TailoringProfile } from './profile.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { profitRange } from '../marketplace/profit-range.ts';
import { purchaseDeal } from '../listing/deal.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
const shrug = { at: AT, notSure: true };
const goals = (over: Partial<MarketGoals> = {}): MarketGoals => ({ ...DEFAULT_GOALS, ...over });
const profile = (g: Partial<MarketGoals>, over: Partial<TailoringProfile> = {}, areas: string[] = []) => plainProfile(goals(g), areas, WIDTHS, over);

const sale = (over: Partial<DealFacts> = {}): DealFacts => ({
  kind: 'sale',
  area: 'NG',
  bedrooms: 3,
  amount: 180_000,
  propertyKind: 'house',
  tenure: 'freehold',
  licensing: 'confirmed-unrestricted',
  grossRevenue: 32_000,
  confidence: 'medium',
  deal: null,
  motivationQualifies: undefined,
  motivationScore: 0,
  needsWork: false,
  ...over,
});
const rental = (over: Partial<DealFacts> = {}): DealFacts =>
  sale({ kind: 'rent', amount: 1_100, deal: { kind: 'rent-to-rent', setupCost: 9_000, breakevenOccupancyPct: 55, paybackMonths: 14, monthlyMargin: 650 } as never, ...over });

const keys = (p: TailoringProfile, f: DealFacts) => {
  const { judgement } = judgeDeal(f, p);
  return Object.fromEntries(judgement.checks.map((c) => [c.key, `${c.mode}:${c.verdict}`]));
};

test('where they look: near a home takes its own area and every area in the radius', () => {
  const w = wantsFor(profile({ where: 'near', home: { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 }, maxDistanceMiles: 30 }));
  assert.ok(w.areas?.has('NG'));
  assert.ok(w.areas?.has('DE'), 'Derby is within 30 miles of Nottingham');
  assert.ok(!w.areas?.has('M'));
  assert.ok(w.home);
  // A home the geocoder has not placed yet stands at its postcode area's centre.
  const unplaced = wantsFor(profile({ where: 'near', home: { postcode: 'NG1 1AA', lat: null, lng: null }, maxDistanceMiles: 20 }));
  assert.ok(unplaced.areas?.has('NG'));
  assert.ok(unplaced.home);
});

test('where they look: chosen areas, anywhere, and near + the best elsewhere', () => {
  assert.deepEqual([...(wantsFor(profile({ where: 'areas' }, {}, ['LS', 'YO'])).areas ?? [])].sort(), ['LS', 'YO']);
  assert.equal(wantsFor(profile({ where: 'anywhere' })).areas, null);
  const best = wantsFor(profile({ where: 'near_plus_best', home: { postcode: 'LS1 4AP', lat: 53.7997, lng: -1.5492 }, maxDistanceMiles: 20 }));
  assert.equal(best.areas, null, 'the rest of the UK is not ruled out');
  assert.ok(best.localAreas?.has('LS'));
});

test('before the quiz, a home with "anywhere is fine" does not pin them to its area (the old quirk)', () => {
  const home = { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 };
  assert.equal(wantsFor(profile({ where: null, home, maxDistanceMiles: null })).areas, null);
  assert.ok(wantsFor(profile({ where: null, home, maxDistanceMiles: 25 })).areas?.has('NG'));
  assert.deepEqual([...(wantsFor(profile({ where: null }, {}, ['M'])).areas ?? [])], ['M']);
});

test('each kind is judged by its own answers: a budget never judges a rental', () => {
  const both = profile({ sourcingKind: 'both', budget: '200-350', maxRentPcm: 1_000 });
  assert.deepEqual(keys(both, sale({ amount: 150_000 })), { budget: 'must:fail' });
  assert.deepEqual(keys(both, rental({ amount: 900 })), { rent: 'must:pass' });
  assert.deepEqual(keys(both, rental({ amount: 1_200 })), { rent: 'must:fail' });
});

test('unknown never removes a deal: it is shown, flagged, and not counted as met', () => {
  const p = profile({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, leaseholdOk: 'no' } }, { modes: { leasehold: 'must' } });
  const { judgement } = judgeDeal(sale({ tenure: tenureOf('Ask agent') }), p);
  assert.deepEqual(judgement.mustFails, []);
  assert.deepEqual(judgement.mustUnknown, ['leasehold']);
  assert.equal(judgement.met, 0);
  assert.equal(judgement.unknown, 1);
  assert.deepEqual(judgeDeal(sale({ tenure: tenureOf('Leasehold') }), p).judgement.mustFails, ['leasehold']);
  assert.deepEqual(judgeDeal(sale({ tenure: tenureOf('freehold') }), p).judgement.mustFails, []);
  assert.deepEqual(judgeDeal(sale({ amount: null }), profile({ budget: 'u200' })).judgement.mustUnknown, ['budget']);
});

test('minimum profit: only a real answer sets it, and it is judged on the low end of the card’s range', () => {
  const finance = { ...DEFAULT_GOALS.finance, targetMarginPcm: 300 };
  const unanswered = profile({ path: 'buy', finance });
  assert.equal(wantsFor(unanswered).minProfit, null, 'the stored default is not an answer');
  assert.equal(wantsFor(profile({ path: 'buy', finance }, { answered: { min_profit: shrug } })).minProfit, null);
  const p = profile({ path: 'buy', finance }, { answered: { min_profit: real } });
  assert.equal(wantsFor(p).minProfit, 300);

  const f = sale({ amount: 150_000, grossRevenue: 30_000 });
  const range = profitRange({ kind: 'sale', priceAmount: 150_000, pricePeriod: 'total', bedrooms: 3, grossRevenue: 30_000, confidence: 'medium', finance, widths: WIDTHS })!;
  assert.deepEqual(memberFigures(f, p).range, range);
  assert.equal(keys(p, f).profit, `must:${range.lowPcm >= 300 ? 'pass' : 'fail'}`);
  assert.equal(keys(p, sale({ grossRevenue: null })).profit, 'must:unknown');
  // A rent-to-rent answer is its own (Batch 17): it judges rentals, never sales.
  const r2r = wantsFor(profile({ path: 'r2r', finance }, { answered: { r2r_min_profit: real } }));
  assert.equal(r2r.minProfitR2r, 300, 'answered before the split, the one figure stands for both');
  assert.equal(r2r.minProfit, null);
  assert.equal(wantsFor(profile({ path: 'r2r', finance, r2r: { ...DEFAULT_GOALS.r2r, minMarginPcm: 900 } }, { answered: { r2r_min_profit: real } })).minProfitR2r, 900);
  assert.equal(wantsFor(profile({ path: 'r2r', finance }, { answered: { min_profit: real } })).minProfit, null, 'the buying question is not asked there');
  const both = profile({ dealTypes: ['buy_str', 'r2r'], finance, r2r: { ...DEFAULT_GOALS.r2r, minMarginPcm: 100_000 } }, { answered: { min_profit: real, r2r_min_profit: real } });
  assert.equal(keys(both, rental()).profit, 'must:fail', 'a rental on the rent-to-rent minimum');
  assert.notEqual(keys(both, f).profit, 'must:fail', 'a sale on the buyer’s, not overwritten');
});

test('a cash buyer: no mortgage in their range or their cash needed, so the must-have agrees with "Most you can pay"', () => {
  const finance = { ...DEFAULT_GOALS.finance, depositPct: 25, targetMarginPcm: 1_500 };
  const buyer = (funding: 'cash' | 'btl') => profile({ path: 'buy', finance, buyer: { ...DEFAULT_GOALS.buyer, funding } }, { answered: { min_profit: real } });
  const f = sale({ amount: 150_000, grossRevenue: 40_000 });
  const cash = memberFigures(f, buyer('cash'));
  const noMortgage = profitRange({ kind: 'sale', priceAmount: 150_000, pricePeriod: 'total', bedrooms: 3, grossRevenue: 40_000, confidence: 'medium', finance: { ...finance, depositPct: 100 }, widths: WIDTHS })!;
  assert.deepEqual(cash.range, noMortgage);
  assert.ok(cash.range!.lowPcm > memberFigures(f, buyer('btl')).range!.lowPcm, 'a mortgage buyer pays a mortgage out of it');
  assert.equal(cash.cashRequired, purchaseDeal(150_000, { grossRevenue: 40_000, adr: 0, bedrooms: 3, finance: { ...finance, depositPct: 100 } }).cashRequired, 'the whole price');
  assert.equal(keys(buyer('cash'), f).profit, noMortgage.lowPcm >= 1_500 ? 'must:pass' : 'must:fail');
});

test('cash available: the top of the band against deposit, stamp duty and setup at their deposit', () => {
  const finance = { ...DEFAULT_GOALS.finance, depositPct: 25 };
  const p = profile({ path: 'buy', finance, buyer: { ...DEFAULT_GOALS.buyer, cashAvailable: '30-60' } });
  const need = purchaseDeal(180_000, { grossRevenue: 32_000, adr: 0, bedrooms: 3, finance }).cashRequired;
  assert.equal(memberFigures(sale(), p).cashRequired, need);
  assert.equal(keys(p, sale()).cash, need <= 60_000 ? 'must:pass' : 'must:fail');
  assert.equal(keys(p, sale({ amount: 400_000 })).cash, 'must:fail');
  assert.equal(wantsFor(profile({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, cashAvailable: '200+' } })).cashTop, null, '"£200k or more" has no ceiling');
});

test('bedrooms: an exact match, "4 or more" for four', () => {
  assert.equal(keys(profile({ bedrooms: 2 }), sale({ bedrooms: 2 })).bedrooms, 'nice:pass');
  assert.equal(keys(profile({ bedrooms: 2 }), sale({ bedrooms: 3 })).bedrooms, 'nice:fail');
  assert.equal(keys(profile({ bedrooms: 4 }), sale({ bedrooms: 6 })).bedrooms, 'nice:pass');
  assert.equal(keys(profile({ bedrooms: 4 }), sale({ bedrooms: null })).bedrooms, 'nice:unknown');
});

test('rent-to-rent checks read the stored figures; no payback at all is a miss', () => {
  const p = profile({ path: 'r2r', r2r: { ...DEFAULT_GOALS.r2r, setupBudget: '6-10k', breakEvenOccupancyPct: 50, paybackMonths: 12 } });
  assert.deepEqual(keys(p, rental()), { setup: 'nice:pass', breakeven: 'nice:fail', payback: 'nice:fail' });
  const losing = rental({ deal: { kind: 'rent-to-rent', setupCost: 5_000, breakevenOccupancyPct: 90, paybackMonths: null, monthlyMargin: -40 } as never });
  assert.equal(keys(p, losing).payback, 'nice:fail');
  assert.equal(keys(p, rental({ deal: null })).payback, 'nice:unknown');
});

test('modes: the member’s switch wins, and motivated sellers follow the answer', () => {
  const p = profile({ budget: 'u200', motivation: { ...DEFAULT_GOALS.motivation, mode: 'only' } }, { modes: { budget: 'nice' } });
  assert.equal(modeOf('budget', p), 'nice');
  assert.equal(modeOf('location', p), 'must');
  assert.equal(modeOf('motivation', p), 'must');
  assert.equal(modeOf('motivation', profile({ motivation: { ...DEFAULT_GOALS.motivation, mode: 'prefer' } })), 'nice');
  assert.equal(keys(p, sale({ motivationQualifies: false })).motivation, 'must:fail', 'no evidence is a miss, as it always was');
});

test('buyer answers left on a profile that no longer buys judge nothing', () => {
  const r2rOnly = profile({ dealTypes: ['r2r'], sourcingKind: 'rent', buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'flat', leaseholdOk: 'no', cashAvailable: 'u30' } });
  assert.deepEqual(keys(r2rOnly, sale()), {});
});

test('the judgement counts what the order and the match % read', () => {
  const j = judge([
    { key: 'location', mode: 'must', verdict: 'pass' },
    { key: 'budget', mode: 'must', verdict: 'unknown' },
    { key: 'bedrooms', mode: 'nice', verdict: 'fail' },
    { key: 'type', mode: 'nice', verdict: 'pass' },
    { key: 'leasehold', mode: 'nice', verdict: 'unknown' },
  ]);
  assert.deepEqual(j.mustFails, []);
  assert.deepEqual(j.mustUnknown, ['budget']);
  assert.equal(j.niceMissed, 1);
  assert.equal(j.met, 2);
  assert.equal(j.unknown, 2);
  assert.equal(j.checked, 5);
  assert.deepEqual(checksFor(sale(), memberFigures(sale(), profile({})), wantsFor(profile({})), () => 'must'), []);
});

test('a marketplace row as facts: rent a week in pcm, the area upper-cased, tenure read', () => {
  const f = factsFromRow(
    { kind: 'rent', postcode_area: 'ng', bedrooms: 2, price_amount: 300, price_period: 'pw', raw_type: 'Flat', tenure: null, screening_gross: '24000', screening_confidence: 'low' },
    null,
    { qualifies: undefined, score: 0 },
  );
  assert.equal(f.amount, 1_300);
  assert.equal(f.area, 'NG');
  assert.equal(f.propertyKind, 'flat');
  assert.equal(f.tenure, 'unknown');
  assert.equal(f.grossRevenue, 24_000);
  assert.equal(factsFromRow({ kind: 'sale', postcode_area: null, bedrooms: null, price_amount: null, price_period: null, raw_type: null, tenure: 'Freehold', screening_gross: null, screening_confidence: null }, null, { qualifies: undefined, score: 0 }).tenure, 'freehold');
});

test('the switches the profile page offers are the checks the answers make', () => {
  const p = profile({ path: 'buy', budget: 'u200', where: 'areas', bedrooms: 2, buyer: { ...DEFAULT_GOALS.buyer, propertyType: 'either', leaseholdOk: 'no', restrictedAreas: 'warn' } }, {}, ['NG']);
  assert.deepEqual([...activeCriteria(wantsFor(p))].sort(), ['bedrooms', 'budget', 'leasehold', 'location']);
  assert.equal(criterionForQuestion('max_rent'), 'rent');
  assert.equal(criterionForQuestion('furnished'), null);
});

test('the daily pick meets a tailored profile’s must-haves; an untailored one is not tested', () => {
  assert.equal(mustHaveTest(plainProfile(goals({ budget: 'u200' }), [], WIDTHS)), null);
  const test = mustHaveTest(profile({ budget: 'u200' }, { answered: { deals_done: real } }))!;
  const listing = (amount: number) => ({ source: 'rightmove' as const, id: 'l', canonicalUrl: 'https://x/l', kind: 'sale' as const, title: 'House', address: null, postcode: null, outcode: 'NG7', postcodeArea: 'NG', lat: null, lng: null, bedrooms: 3, bathrooms: null, price: { amount, period: 'total' as const }, rawType: 'Terraced house', photo: null });
  assert.equal(test({ listing: listing(150_000), deal: null }), true);
  assert.equal(test({ listing: listing(250_000), deal: null }), false);
});

// ── Batch 17: each deal judged as its own type ──

const PROJECT = { v: 1 as const, level: 'full' as const, price: 70_000, bedrooms: 3, worksLow: 26_620, worksHigh: 39_710, value: 127_800, valueAdded: 18_090, valueAddedPct: 14.2, ceilingApplied: false, months: 4, cashLow: 74_766, cashHigh: 87_856, moneyLeftInLow: 27_916, moneyLeftInHigh: 41_006, refinancePct: 75, estimatedAt: AT };
const brrrDeal = (over: Partial<DealFacts> = {}): DealFacts => sale({ amount: 70_000, dealType: 'brrr', project: PROJECT, needsWork: true, ...over });
const typed = (g: Partial<MarketGoals>, answered: TailoringProfile['answered'] = {}) => profile({ dealTypes: ['buy_str', 'brrr'], ...g }, { answered: { deal_types: real, ...answered } });

test('a BRRR deal is judged on the project budget, before works; a Short-let deal on the budget', () => {
  const p = typed({ budget: '200-350', brrr: { budget: 'u200', work: null } });
  assert.equal(keys(p, brrrDeal()).budget, 'must:pass', '£70k inside the project budget');
  assert.equal(keys(p, sale({ amount: 70_000 })).budget, 'must:fail', 'the same price is under the buy budget');
  assert.equal(keys(p, brrrDeal({ amount: 240_000 })).budget, 'must:fail');
  const noProjectBudget = typed({ budget: '200-350', brrr: { budget: null, work: null } });
  assert.equal(keys(noProjectBudget, brrrDeal()).budget, undefined, 'no project budget, no check: the buy budget never judges a project');
});

test('a BRRR deal’s profit is after the works (after the refinance on a full project), low end, against the buyer’s minimum', () => {
  const p = typed({ finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 400 } }, { min_profit: real });
  const fig = memberFigures(brrrDeal(), p);
  assert.ok(fig.range);
  assert.equal(fig.range!.basis, 'short-let profit after the works');
  // The refinance mortgage is on 75% of the value after works, not the price.
  const onPrice = memberFigures(sale({ amount: 70_000 }), p).range!;
  assert.ok(fig.range!.midPcm < onPrice.midPcm, 'a bigger loan after the refinance leaves less each month');
  const verdict = fig.range!.lowPcm >= 400 ? 'must:pass' : 'must:fail';
  assert.equal(keys(p, brrrDeal()).profit, verdict);
  assert.equal(fig.cashRequired, PROJECT.cashLow, 'cash needed: the clearly needed works (unknown works never remove a deal)');
  assert.equal(fig.cashOnCashPct, null);
  // No income figure: the profit is unknown, never guessed.
  assert.equal(keys(p, brrrDeal({ grossRevenue: null })).profit, 'must:unknown');
});

test('"How much work?" Light refresh matches light projects only; Full project and Either match both (Q24)', () => {
  const light = typed({ brrr: { budget: null, work: 'light' } }, { brrr_work: real });
  assert.equal(keys(light, brrrDeal()).work, 'must:fail', 'a full project for a light-refresh answer');
  assert.equal(keys(light, brrrDeal({ project: { ...PROJECT, level: 'light' } })).work, 'must:pass');
  assert.equal(keys(light, sale()).work, undefined, 'a Short-let deal is never judged on it');
  for (const work of ['full', 'either'] as const) {
    const p = typed({ brrr: { budget: null, work } }, { brrr_work: real });
    assert.equal(keys(p, brrrDeal()).work, undefined, `${work}: both levels, so no check`);
    assert.equal(activeCriteria(wantsFor(p)).has('work'), false);
  }
  assert.equal(activeCriteria(wantsFor(light)).has('work'), true);
  assert.equal(criterionForQuestion('brrr_work'), 'work');
  assert.equal(criterionForQuestion('brrr_budget'), 'budget');
  // A profile that no longer wants BRRR is not judged on its old answer.
  const gone = profile({ dealTypes: ['r2r'], brrr: { budget: null, work: 'light' } }, { answered: { deal_types: real, brrr_work: real } });
  assert.equal(wantsFor(gone).brrrWork, null);
});

test('a pool row with a Project estimate reads as a BRRR deal; without, as its kind', () => {
  const row = { kind: 'sale' as const, postcode_area: 'yo', bedrooms: 3, price_amount: 70_000, price_period: 'total', raw_type: 'End of terrace', tenure: 'Freehold', screening_gross: '24000', screening_confidence: 'medium', check_comps: null };
  const f = factsFromRow({ ...row, project: PROJECT }, null, { qualifies: undefined, score: 0 });
  assert.equal(f.dealType, 'brrr');
  assert.equal(f.needsWork, true);
  assert.equal(f.project?.worksHigh, 39_710);
  const plain = factsFromRow(row, null, { qualifies: undefined, score: 0 });
  assert.equal(plain.dealType, 'buy_str');
  assert.equal(plain.project, null);
  assert.equal(factsFromRow({ ...row, project: { junk: true } }, null, { qualifies: undefined, score: 0 }).dealType, 'buy_str', 'an unusable estimate is not a Project deal');
  assert.equal(factsFromRow({ ...row, kind: 'rent', price_period: 'pcm', price_amount: 900, project: PROJECT }, null, { qualifies: undefined, score: 0 }).dealType, 'r2r');
});
