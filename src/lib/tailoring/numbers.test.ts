import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numbersForCard, priceCutPct, roleFor } from './numbers.ts';
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
  const manager = profile({ path: 'manage', manager: { ...DEFAULT_GOALS.manager, operatingAreas: ['NG'] } });
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
