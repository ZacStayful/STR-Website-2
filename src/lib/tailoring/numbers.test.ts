import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersForCard, priceCutPct, roleFor, withTailoring, type CardNumber } from './numbers.ts';
import type { Explanation } from './why.ts';
import { plainProfile, type TailoringProfile } from './profile.ts';
import { areaLookup } from './order.ts';
import { DEFAULT_GOALS, type MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT, type AboutYou } from '../profile/about.ts';
import type { DealCard } from '../marketplace/grid.ts';
import type { AreaCardData } from '../market/explorer.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const WIDTHS = { high: 10, medium: 15, low: 25 };
const AT = '2026-09-20T10:00:00Z';
const real = { at: AT, notSure: false };

const card = (over: Partial<DealCard> = {}): DealCard => ({
  id: 'd1', source: 'rightmove', kind: 'sale', postcode_area: 'NG', outcode: 'NG7', town: 'Nottingham', bedrooms: 3,
  price_amount: 160_000, price_period: 'total', raw_type: 'Terraced house', tenure: 'Freehold', band: 'qualified',
  annual_profit: 12_000, uplift_pct: 40, reduced_at: null, listed_date: '2026-03-01T00:00:00Z', status: 'live',
  first_seen_at: '2026-03-01T00:00:00Z', last_checked_live_at: null, last_confirmed_at: AT, last_confirmed_via: 'live',
  screening_gross: '30000', screening_confidence: 'medium', motivation: null, price_history: null,
  ...over,
});
const area = areaLookup([
  { code: 'NG', byBedrooms: [{ bedrooms: 3, propertyValueMid: 200_000 }], keyStats: { growth5y: 18 }, competition: { label: 'Opportunity' }, headline: { occupancy: 64 } } as unknown as AreaCardData,
  { code: 'DE', byBedrooms: [], keyStats: null, competition: null, headline: { occupancy: 58 } } as unknown as AreaCardData,
]);
const profile = (g: Partial<MarketGoals>, about: Partial<AboutYou> = {}, over: Partial<TailoringProfile> = {}) =>
  plainProfile({ ...DEFAULT_GOALS, ...g }, [], WIDTHS, { about: { ...DEFAULT_ABOUT, dealsDone: '4-10', ...about }, answered: { deals_done: real, main_goal: real, operating_areas: real }, ...over });
const shown = (n: ReturnType<typeof numbersForCard>) => (n ?? []).map((x) => `${x.label}: ${x.value}`);

test('no new answers: the card is exactly as it was', () => {
  assert.equal(numbersForCard(card(), plainProfile(DEFAULT_GOALS, [], WIDTHS), area, NOW), null);
  assert.equal(numbersForCard(card(), null, area, NOW), null);
});

test('a buyer after cash flow: cash flow, cash needed, return on cash', () => {
  const n = numbersForCard(card(), profile({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, mainGoal: 'cashflow' } }), area, NOW)!;
  assert.deepEqual(n.map((x) => x.key), ['profit', 'cash', 'coc']);
  assert.match(n[0].value, /£/);
  assert.equal(n[0].label, 'Cash flow / month');
  assert.match(n[1].value, /^£\d{2},\d{3}$/);
  assert.match(n[2].value, /%$/);
  assert.ok(n.every((x) => x.help === null), 'no beginner lines for someone who has done deals');
});

test('a buyer after growth: yield, against the typical price, the area trend; cash needed when the trend is unknown', () => {
  const growth = profile({ path: 'buy', buyer: { ...DEFAULT_GOALS.buyer, mainGoal: 'growth' } });
  assert.deepEqual(shown(numbersForCard(card(), growth, area, NOW)), ['Gross yield: 15.9–21.6%', 'Against a typical 3-bed: £40k under', 'Area prices, 5 years: +18%']);
  const derby = numbersForCard(card({ postcode_area: 'DE' }), growth, area, NOW)!;
  assert.deepEqual(derby.map((x) => x.key), ['yield', 'cash', 'profit']);
});

test('rent-to-rent: profit, setup cost and break-even, from the rental’s stored figures', () => {
  const rental = card({ kind: 'rent', price_amount: 1_100, price_period: 'pcm', deal_setup: '9000', deal_breakeven: '54.2', deal_payback: '14', deal_margin: '650' });
  const n = numbersForCard(rental, profile({ path: 'r2r', sourcingKind: 'rent' }), area, NOW)!;
  assert.deepEqual(n.map((x) => x.key), ['profit', 'setup', 'breakeven']);
  assert.equal(n[0].label, 'Profit / month');
  assert.equal(n[1].value, '£9,000');
  assert.equal(n[2].value, '54% booked');
  // A buyer looking at a rental still reads it as a rental.
  assert.equal(roleFor(profile({ path: 'buy' }), 'rent'), 'r2r');
});

test('deal sourcers: room below the typical price, the motivated-seller signal, the price; a price cut when there is no room', () => {
  const sourcer = profile({ path: 'source', sourcingKind: 'both' });
  const motivated = card({ motivation: { score: 55, firmScore: 40, fired: ['price_reduced'] }, price_history: [{ at: '2026-06-01T00:00:00Z', amount: 160_000, previousAmount: 175_000 }] });
  assert.deepEqual(shown(numbersForCard(motivated, sourcer, area, NOW)), ['Room below typical: £40k under', 'Motivated seller: Price reduced', 'Asking: £160,000']);
  const over = numbersForCard({ ...motivated, price_amount: 240_000, price_history: [{ at: '2026-06-01T00:00:00Z', amount: 240_000, previousAmount: 260_000 }] }, sourcer, area, NOW)!;
  assert.deepEqual(shown(over), ['Price cut: 8% off', 'Motivated seller: Price reduced', 'Asking: £240,000']);
  assert.equal(priceCutPct([{ at: AT, amount: 150_000, previousAmount: 200_000 }], 150_000), 25);
  assert.equal(priceCutPct(null, 150_000), null);
});

test('management companies: revenue, distance to their units, local competition; occupancy when competition is unknown', () => {
  const manager = profile({ path: 'manage', manager: { ...DEFAULT_GOALS.manager, operatingAreas: ['NG'] } }, { roles: ['manager'] });
  assert.deepEqual(shown(numbersForCard(card(), manager, area, NOW)), ['Short-let revenue: £25,500–£34,500/yr', 'From your units: Same area', 'Competition: Opportunity']);
  const derby = numbersForCard(card({ postcode_area: 'DE' }), manager, area, NOW)!;
  assert.deepEqual(derby.map((x) => x.key), ['revenue', 'distance', 'occupancy']);
});

test('beginners get a plain line under each number; the Funding blocker puts cash needed first', () => {
  const beginner = numbersForCard(card(), profile({ path: 'buy' }, { dealsDone: '0' }), area, NOW)!;
  assert.ok(beginner.every((x) => typeof x.help === 'string' && x.help.length > 0));
  const funding = numbersForCard(card(), profile({ path: 'buy' }, { blocker: 'funding' }), area, NOW)!;
  assert.deepEqual(funding.map((x) => x.key), ['cash', 'profit', 'coc']);
});

test('nothing private reaches a number', () => {
  for (const p of [profile({ path: 'buy' }), profile({ path: 'source' }), profile({ path: 'manage', manager: { ...DEFAULT_GOALS.manager, operatingAreas: ['NG'] } })]) {
    const text = JSON.stringify(numbersForCard({ ...card(), canonical_url: 'https://www.rightmove.co.uk/properties/1', address: '1 High Street', postcode: 'NG7 1AA' } as DealCard, p, area, NOW));
    for (const secret of ['rightmove', 'High Street', 'NG7 1AA']) assert.ok(!text.includes(secret), secret);
  }
});

test('withTailoring: Today gives an untailored member the plain why-line only; "Best elsewhere" is Today’s alone', () => {
  const views = new Map<string, { numbers: CardNumber[] | null; explanation: Explanation | null }>([['d1', { numbers: null, explanation: null }]]);
  const plain = withTailoring(views, [card()], plainProfile(DEFAULT_GOALS, [], WIDTHS), null, NOW, { why: true }).get('d1')!;
  assert.equal(plain.numbers, null, 'no new answers: no numbers');
  assert.equal(plain.explanation?.why, 'Picked for: +40% on a long let');
  assert.equal(plain.explanation?.match, null);
  assert.equal(withTailoring(views, [card()], plainProfile(DEFAULT_GOALS, [], WIDTHS), null, NOW).get('d1')!.explanation, null, 'Browse: nothing added for them');
  const best = profile({ path: 'buy', where: 'near_plus_best', home: { postcode: 'DE1 1AA', lat: 52.92, lng: -1.47 }, maxDistanceMiles: 10 });
  assert.equal(withTailoring(views, [card()], best, null, NOW, { why: true }).get('d1')!.explanation?.elsewhere, true);
  assert.equal(withTailoring(views, [card()], best, null, NOW).get('d1')!.explanation?.elsewhere, false);
});

// ── Batch 17: the numbers follow the deal's own type (Q23) ──

const PROJECT = { v: 1, level: 'full', price: 70_000, bedrooms: 3, worksLow: 26_620, worksHigh: 39_710, value: 127_800, valueAdded: 18_090, valueAddedPct: 14.2, ceilingApplied: false, months: 4, cashLow: 74_766, cashHigh: 87_856, moneyLeftInLow: 27_916, moneyLeftInHigh: 41_006, refinancePct: 75, estimatedAt: AT };
const projectCard = (over: Partial<DealCard> = {}) => ({ ...card({ price_amount: 70_000, screening_gross: '24000', ...over }), project: PROJECT }) as DealCard;

test('a Project deal shows the project’s numbers to everyone, sourcers and managers too', () => {
  const investor = profile({ dealTypes: ['brrr'] }, { roles: ['investor'] });
  const n = numbersForCard(projectCard(), investor, area, NOW)!;
  assert.deepEqual(n.map((x) => x.key), ['works', 'valueAdded', 'afterWorks']);
  assert.equal(n[0].value, '~£27k–£40k');
  assert.equal(n[1].value, '£18k');
  assert.equal(n[2].label, 'After works / month');
  for (const roles of [['sourcer'], ['manager']] as AboutYou['roles'][]) assert.equal(roleFor(profile({ dealTypes: ['brrr'] }, { roles }), 'brrr'), 'brrr', roles.join());
  // The Funding blocker puts the project's own cash first, as a range (Q26).
  const funding = numbersForCard(projectCard(), profile({ dealTypes: ['brrr'] }, { roles: ['investor'], blocker: 'funding' }), area, NOW)!;
  assert.deepEqual(shown(funding).slice(0, 1), ['Cash in: £75k–£88k']);
});

test('sourcers and managers keep their own numbers on other deals, unless they also invest or run rent-to-rent (Q23 a)', () => {
  assert.equal(roleFor(profile({}, { roles: ['sourcer'] }), 'buy_let'), 'source');
  assert.equal(roleFor(profile({}, { roles: ['sourcer'] }), 'r2r'), 'source');
  assert.equal(roleFor(profile({}, { roles: ['manager'] }), 'buy_let'), 'manage');
  assert.equal(roleFor(profile({}, { roles: ['sourcer', 'investor'] }), 'buy_let'), 'buy_cashflow');
  assert.equal(roleFor(profile({}, { roles: ['manager', 'r2r'] }), 'r2r'), 'r2r');
  assert.equal(roleFor(profile({}, { roles: ['investor'] }), 'r2r'), 'r2r', 'an investor looking at a rental reads it as a rental');
  // Answered before the roles question: the old path decides, as before.
  assert.equal(roleFor(profile({ path: 'source' }, { roles: [] }), 'sale'), 'source');
});
