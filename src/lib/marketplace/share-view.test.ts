import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShareToken, joinPath, shareState, shareTitle } from './share-view.ts';
import { dealVisibility } from './visibility.ts';
import type { DealCard } from './grid.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const PUBLIC = dealVisibility('free', NOW, 48).cutoffIso;

const card = (over: Partial<DealCard> = {}): DealCard => ({
  id: 'dddddddd-0000-4000-8000-000000000001',
  source: 'rightmove',
  kind: 'sale',
  postcode_area: 'YO',
  outcode: 'YO24',
  town: 'York',
  bedrooms: 3,
  price_amount: 250_000,
  price_period: 'total',
  raw_type: 'Terraced',
  tenure: 'Freehold',
  band: 'qualified',
  annual_profit: 9_000,
  uplift_pct: 45,
  reduced_at: null,
  listed_date: null,
  status: 'live',
  first_seen_at: hoursAgo(100),
  last_checked_live_at: null,
  last_confirmed_at: hoursAgo(2),
  last_confirmed_via: 'feed',
  ...over,
});

test('gone, members-only inside the window, the card outside it', () => {
  assert.equal(shareState({ status: 'retired', live_since: hoursAgo(500) }, PUBLIC), 'gone');
  assert.equal(shareState({ status: 'live', live_since: hoursAgo(72) }, PUBLIC), 'card');
  assert.equal(shareState({ status: 'live', live_since: hoursAgo(10) }, PUBLIC), 'members_only', 'a share link cannot get round the delay');
  assert.equal(shareState({ status: 'live', live_since: null }, PUBLIC), 'members_only');
  assert.equal(shareState({ status: 'pending_verify', live_since: hoursAgo(500) }, PUBLIC), 'members_only');
  assert.equal(shareState({ status: 'live', live_since: hoursAgo(1) }, null), 'card', 'no delay configured');
});

test('the join link carries a well-formed referral code and nothing else', () => {
  assert.equal(joinPath('abcd2345'), '/signup?ref=ABCD2345');
  assert.equal(joinPath(null), '/signup');
  assert.equal(joinPath(''), '/signup');
  assert.equal(joinPath('../evil'), '/signup');
  assert.equal(joinPath('A&next=/admin'), '/signup');
});

test('share tokens have the same shape as every other token', () => {
  assert.ok(isShareToken('A'.repeat(32)));
  assert.ok(!isShareToken('short'));
  assert.ok(!isShareToken('x'.repeat(24) + '/..'));
  assert.ok(!isShareToken(null));
});

test('the preview title holds card facts only, and none in the members-only state', () => {
  const c = card();
  assert.equal(shareTitle(c, 'York · YO24', 'card'), '+45% £9,000/yr over a long let · 3 bed terraced · Freehold · York · YO24');
  const hidden = shareTitle(c, 'York', 'members_only');
  assert.equal(hidden, 'A new short-let deal in York — available to members');
  assert.ok(!/\d{2},\d{3}|%|£/.test(hidden), 'no figure, price or percentage while in early access');
  assert.equal(shareTitle(c, 'York', 'gone'), 'This deal has gone — Stayful');
  assert.equal(shareTitle(card({ uplift_pct: null, annual_profit: null, bedrooms: null, raw_type: null, tenure: null }), '', 'card'), 'A short-let deal on Stayful');
});
