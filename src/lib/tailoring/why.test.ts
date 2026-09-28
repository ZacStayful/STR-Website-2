import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainCard, genericWhy, matchLine } from './why.ts';
import { plainProfile, type TailoringProfile } from './profile.ts';
import { areaLookup } from './order.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import type { DealCard } from '../marketplace/grid.ts';
import type { Judgement } from './criteria.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };
const noArea = areaLookup(null);

const card = (over: Partial<DealCard> = {}): DealCard => ({
  id: 'd1', source: 'rightmove', kind: 'rent', postcode_area: 'DE', outcode: 'DE1', town: 'Derby', bedrooms: 2,
  price_amount: 1_100, price_period: 'pcm', raw_type: 'Terraced house', tenure: null, band: 'qualified',
  annual_profit: 9_000, uplift_pct: null, reduced_at: null, listed_date: '2026-06-01T00:00:00Z', status: 'live',
  first_seen_at: '2026-06-01T00:00:00Z', last_checked_live_at: null, last_confirmed_at: AT, last_confirmed_via: 'live',
  screening_gross: '42000', screening_confidence: 'medium', motivation: null, price_history: null,
  deal_setup: '9000', deal_breakeven: '48', deal_payback: '12', deal_margin: '760',
  ...over,
});
const home = { postcode: 'NG1 1AA', lat: 52.9536, lng: -1.1505 };
const operator = (g: Partial<MarketGoals> = {}, over: Partial<TailoringProfile> = {}) =>
  plainProfile({ ...DEFAULT_GOALS, path: 'r2r', sourcingKind: 'rent', where: 'near', home, maxDistanceMiles: 30, maxRentPcm: 1_500, bedrooms: 2, finance: { ...DEFAULT_GOALS.finance, targetMarginPcm: 400 }, ...g }, [], WIDTHS, { answered: { r2r_min_profit: real }, ...over });

test('the why-line: the must-haves it meets first, then the nice-to-haves, in fixed words', () => {
  const e = explainCard(card(), operator(), noArea, NOW);
  assert.equal(e.why, 'about 18 miles away · under £1,500 pcm · clears your £400 minimum · 2-bed');
  assert.equal(e.match, '100% match · 4 of 4');
  assert.deepEqual(e.flags, []);
  assert.equal(e.elsewhere, false);
});

test('the match counts an unknown as not met, and says so', () => {
  const e = explainCard(card({ bedrooms: null }), operator(), noArea, NOW);
  assert.equal(e.match, '75% match · 3 of 4 · 1 unknown');
  const j = (met: number, checked: number, unknown = 0): Judgement => ({ checks: [], mustFails: [], mustUnknown: [], niceMissed: 0, met, unknown, checked });
  assert.equal(matchLine(j(5, 6)), '83% match · 5 of 6');
  assert.equal(matchLine(j(1, 1)), null, 'one check says nothing useful');
});

test('an unknown must-have is flagged; "show them with a warning" warns on a licensed area', () => {
  const buyer = plainProfile({ ...DEFAULT_GOALS, path: 'buy', sourcingKind: 'sale', budget: 'u200', buyer: { ...DEFAULT_GOALS.buyer, restrictedAreas: 'warn' } }, [], WIDTHS, { answered: { restricted_areas: real, deals_done: real } });
  const sale = card({ kind: 'sale', price_amount: null, price_period: 'total', postcode_area: 'EH', deal_setup: null, deal_breakeven: null, deal_payback: null, deal_margin: null });
  const e = explainCard(sale, buyer, noArea, NOW);
  assert.ok(e.flags.includes('Price unknown: check'));
  assert.ok(e.flags.includes('Short-let licence needed here'), 'Edinburgh needs a licence');
});

test('near me + the best elsewhere: a deal from outside their area says so', () => {
  const best = operator({ where: 'near_plus_best', maxDistanceMiles: 10 });
  assert.equal(explainCard(card({ postcode_area: 'M' }), best, noArea, NOW).elsewhere, true);
  assert.equal(explainCard(card({ postcode_area: 'NG' }), best, noArea, NOW).elsewhere, false);
});

test('no new answers: the deal’s strongest fact, and no match', () => {
  const e = explainCard(card(), plainProfile(DEFAULT_GOALS, [], WIDTHS), noArea, NOW);
  assert.equal(e.why, 'Picked for: £9k/yr after rent');
  assert.equal(e.match, null);
  assert.equal(genericWhy(card({ kind: 'sale', uplift_pct: 55, annual_profit: 12_000 }), NOW), 'Picked for: +55% on a long let');
  assert.equal(genericWhy(card({ kind: 'sale', uplift_pct: 10 }), NOW), null);
});

test('nothing in a why-line comes from a listing’s own text', () => {
  const e = explainCard({ ...card(), raw_type: '12 Acacia Avenue terraced house', town: 'Derby' } as DealCard, operator(), noArea, NOW);
  assert.ok(!/Acacia/.test(`${e.why} ${e.match} ${e.flags.join(' ')}`));
});
