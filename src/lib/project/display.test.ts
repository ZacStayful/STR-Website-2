import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindWordFor, projectOf, projectRangeLine, projectNumbersFor, rangeLineFor } from './display.ts';
import type { ProjectCardData } from './headline.ts';
import { cardView, NOT_OPENED } from '../marketplace/card-view.ts';
import { areaDealView, badgesFor, type DealCard } from '../marketplace/grid.ts';
import { shareTitle } from '../marketplace/share-view.ts';
import { allocate, priceLabel, type GrantLite } from '../credit/deal-pricing.ts';
import { DEFAULT_DEAL_OPEN_LADDER } from '../marketplace/ladder.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };
const PRICING = { fullAnalysisPence: 400, pmiAddonPence: 200, profitRangePct: WIDTHS };
const planOnly: GrantLite[] = [{ id: 'p', kind: 'plan', priority: 1, remainingPence: 5000, spendRate: 1, expiresAt: null, createdAt: '2026-09-01T00:00:00Z' }];
const label = (base: number) => priceLabel(allocate(planOnly, base), { admin: false, spendableBasePence: 10_000 });

const PROJECT: ProjectCardData = {
  v: 1,
  level: 'full',
  price: 70_000,
  bedrooms: 3,
  worksLow: 26_620,
  worksHigh: 39_710,
  value: 127_800,
  valueAdded: 18_090,
  valueAddedPct: 14.2,
  ceilingApplied: false,
  months: 4,
  cashLow: 75_000,
  cashHigh: 88_000,
  moneyLeftInLow: 28_000,
  moneyLeftInHigh: 41_000,
  refinancePct: 75,
  estimatedAt: '2026-09-29T05:00:00Z',
};

const card = (over: Partial<DealCard> = {}): DealCard => ({
  id: 'd1',
  source: 'rightmove',
  kind: 'sale',
  postcode_area: 'YO',
  outcode: 'YO17',
  town: 'Norton',
  bedrooms: 3,
  price_amount: 70_000,
  price_period: 'total',
  raw_type: 'End of Terrace',
  tenure: 'Freehold',
  band: 'strong',
  annual_profit: 9_000,
  uplift_pct: 45,
  reduced_at: null,
  listed_date: null,
  status: 'live',
  first_seen_at: '2026-09-20T05:00:00Z',
  last_checked_live_at: '2026-09-29T05:00:00Z',
  last_confirmed_at: '2026-09-29T05:00:00Z',
  last_confirmed_via: 'live',
  live_since: '2026-09-29T05:10:00Z',
  screening_gross: '30000',
  screening_confidence: 'high',
  check_comps: '12',
  deal_cash: '24000',
  ...over,
});

test('a Project deal is a sale carrying usable card numbers; anything else is not', () => {
  assert.equal(projectOf(card({ project: PROJECT }))?.valueAdded, 18_090);
  assert.equal(projectOf(card()), null);
  assert.equal(projectOf({ kind: 'rent', project: PROJECT }), null);
  assert.equal(projectOf({ kind: 'sale', project: { v: 2 } }), null, 'an unreadable row reads as not a Project deal');
  assert.equal(kindWordFor(card({ project: PROJECT })), 'Project');
  assert.equal(kindWordFor(card()), 'To buy');
  assert.equal(kindWordFor({ kind: 'rent' }), 'Rent-to-rent');
});

test('every email and list line: a Project deal leads with its profit after works, then value added, works and cash', () => {
  const line = rangeLineFor(card({ project: PROJECT }), null, WIDTHS)!;
  const parts = line.split(' · ');
  assert.match(parts[0], /^£[\d,]+–£[\d,]+\/mo after works$/);
  assert.equal(parts[1], 'based on 12 similar Airbnbs nearby', 'the second part is the caption, as the welcome page reads it');
  assert.equal(parts[2], '£18k value added');
  assert.equal(parts[3], 'Works ~£27k–£40k');
  assert.equal(parts[4], '£75k–£88k cash in');
  // Numbers only: never a reason, a line or a photo.
  assert.ok(!/photo|reason|kitchen|rewire/i.test(line));
  // An ordinary sale keeps its own line.
  assert.match(rangeLineFor(card(), null, WIDTHS)!, /^£[\d,]+–£[\d,]+\/mo · based on 12 similar Airbnbs nearby · £24k cash in$/);
  // Without an income figure the value added leads.
  assert.match(projectRangeLine(projectNumbersFor({ screening_gross: null }, PROJECT, null, WIDTHS)), /^£18k value added · Works/);
});

test('the card: profit after works, the works and value added, the cash as a range; no "Most you can pay", no uplift, no low entry', () => {
  const v = cardView({ card: card({ project: PROJECT }), state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label });
  assert.equal(v.range?.basis, 'profit after works');
  assert.equal(v.projectLine, 'Works ~£27k–£40k · £18k value added');
  assert.equal(v.cash, '£75k–£88k cash in');
  assert.equal(v.pay, null);
  assert.equal(v.uplift, null);
  assert.equal(v.lowEntry, false);
  const ordinary = cardView({ card: card(), state: NOT_OPENED, admin: false, pricing: PRICING, ladder: DEFAULT_DEAL_OPEN_LADDER, label });
  assert.equal(ordinary.projectLine, null);
  assert.equal(ordinary.uplift, '+45% vs a long let');
});

test('the area blocks and the public teaser: the Project badge and its numbers', () => {
  const view = areaDealView(card({ project: PROJECT }), null, new Date('2026-09-29T12:00:00Z'), WIDTHS);
  assert.equal(view.label, 'Project');
  assert.match(view.figureBig, /\/mo$/);
  assert.match(view.figureSmall, /after works · Works ~£27k–£40k · £18k value added$/);
  assert.equal(areaDealView(card(), null, new Date(), WIDTHS).label, 'To buy');
});

test('a Project deal is new from when it went live (it waited for its check), an ordinary one from when it was first seen', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  assert.ok(badgesFor(card({ project: PROJECT }), now).tags.includes('New today'));
  assert.ok(!badgesFor(card(), now).tags.includes('New today'));
});

test('the share preview leads with what the works add', () => {
  assert.equal(shareTitle(card({ project: PROJECT }), 'Norton', 'card', '£1,000–£1,400/mo'), 'Project · £18k value added · 3 bed end of terrace · Freehold · Norton');
  assert.match(shareTitle(card(), 'Norton', 'card', '£1,000–£1,400/mo'), /^£1,000–£1,400\/mo based on 12 similar Airbnbs nearby/);
});
