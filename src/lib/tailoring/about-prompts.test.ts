import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actFastTitle, consentOpening, leadFor, wantsActFast } from './about-prompts.ts';
import { plainProfile } from './profile.ts';
import { DEFAULT_GOALS } from '../market/goals.ts';
import { DEFAULT_ABOUT, type AboutYou } from '../profile/about.ts';
import type { DealFacts } from '../pipeline/facts.ts';

const NOW = new Date('2026-09-28T09:00:00Z');
const WIDTHS = { high: 10, medium: 15, low: 25 };
const real = { at: '2026-09-20T10:00:00Z', notSure: false };
const unsure = { at: '2026-09-20T10:00:00Z', notSure: true };
const member = (about: Partial<AboutYou>, answered: Record<string, typeof real> = {}) => plainProfile(DEFAULT_GOALS, [], WIDTHS, { about: { ...DEFAULT_ABOUT, ...about }, answered });

const facts = (over: Partial<DealFacts> = {}): DealFacts => ({
  kind: 'rent',
  address: '12 Acacia Avenue, Derby',
  town: 'Derby',
  bedrooms: 2,
  price: { amount: 1_100, period: 'pcm' },
  listedDate: null,
  firstSeenAt: null,
  dealStatus: 'live',
  retiredReason: null,
  lastConfirmedAt: null,
  postcodeArea: 'DE',
  marketplace: true,
  ...over,
});

test('what holds them back decides what leads: the Full analysis or the consent message', () => {
  assert.equal(leadFor(member({ blocker: 'numbers' }, { blocker: real })), 'analysis');
  assert.equal(leadFor(member({ blocker: 'consent' }, { blocker: real })), 'consent');
  assert.equal(leadFor(member({ blocker: 'funding' }, { blocker: real })), null, 'funding works through the numbers (cash needed first)');
  assert.equal(leadFor(member({ blocker: 'numbers' }, { blocker: unsure })), null, '"Not sure" is no answer');
  assert.equal(leadFor(member({ blocker: 'numbers' })), null);
  assert.equal(leadFor(null), null);
});

test('the consent opening: the Kept message’s first paragraphs, never the address', () => {
  const r2r = consentOpening(facts(), NOW)!;
  assert.equal(r2r.heading, 'Asking for consent');
  assert.equal(r2r.lines.length, 3);
  assert.match(r2r.lines[0], /2-bedroom property, advertised at £1,100 a month/);
  assert.match(r2r.lines.join(' '), /written consent/);
  assert.ok(!/Acacia/.test(JSON.stringify(r2r)), 'the address never shows, even when the facts hold it');
  assert.ok(!/^Hello/.test(r2r.lines[0]), 'no greeting');
  const sale = consentOpening(facts({ kind: 'sale', price: { amount: 185_000, period: 'total' } }), NOW)!;
  assert.match(sale.lines[0], /listed at £185,000/);
  assert.ok(!/Acacia/.test(JSON.stringify(sale)));
  assert.equal(consentOpening(facts({ kind: 'other' }), NOW), null);
});

test('"Act fast · new today" only for a deal first seen in the last day, and only when their next deal is this month', () => {
  assert.equal(wantsActFast(member({ nextDeal: 'this_month' }, { next_deal: real })), true);
  assert.equal(wantsActFast(member({ nextDeal: '1-3m' }, { next_deal: real })), false);
  assert.equal(wantsActFast(member({ nextDeal: 'this_month' }, { next_deal: unsure })), false);
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  assert.equal(actFastTitle('£450–£700/mo', hoursAgo(3), NOW), 'Act fast · new today · £450–£700/mo');
  assert.equal(actFastTitle('£450–£700/mo', hoursAgo(25), NOW), '£450–£700/mo');
  assert.equal(actFastTitle('£450–£700/mo', null, NOW), '£450–£700/mo');
  assert.equal(actFastTitle('£450–£700/mo', 'not a date', NOW), '£450–£700/mo');
});
