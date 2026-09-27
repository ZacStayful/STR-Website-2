import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askingAmount, bedroomsText, countWord, formatAge, memberNameText, messageFields, offMarketReason, priceIsStale, reductionCount, stepKindOf, timeOnMarket, type DealFacts } from './facts.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const base: DealFacts = {
  kind: 'sale',
  address: '12 High Street, Leeds',
  town: 'Leeds',
  bedrooms: 2,
  price: { amount: 185000, period: 'total' },
  listedDate: daysAgo(213),
  firstSeenAt: daysAgo(30),
  priceHistory: [],
  motivation: null,
  dealStatus: 'live',
  retiredReason: null,
  lastConfirmedAt: daysAgo(1),
  postcodeArea: 'LS',
  marketplace: true,
};

test('kinds map to purchase and rent-to-rent; anything else has no next step', () => {
  assert.equal(stepKindOf('sale'), 'purchase');
  assert.equal(stepKindOf('rent'), 'rent-to-rent');
  assert.equal(stepKindOf('str'), null);
});

test('asking amount: a total for a purchase, a monthly rent for rent-to-rent', () => {
  assert.equal(askingAmount(base, 'purchase'), 185000);
  assert.equal(askingAmount({ price: { amount: 1100, period: 'pcm' } }, 'rent-to-rent'), 1100);
  assert.equal(askingAmount({ price: { amount: 300, period: 'pw' } }, 'rent-to-rent'), 1300);
  assert.equal(askingAmount({ price: { amount: 1100, period: 'pcm' } }, 'purchase'), null);
  assert.equal(askingAmount({ price: { amount: 0, period: 'total' } }, 'purchase'), null);
  assert.equal(askingAmount({ price: { amount: -5, period: 'total' } }, 'purchase'), null);
  assert.equal(askingAmount({ price: { amount: Number.NaN, period: 'total' } }, 'purchase'), null);
  assert.equal(askingAmount({ price: null }, 'purchase'), null);
});

test('time on market: the portal date first, our sighting as a floor', () => {
  assert.deepEqual(timeOnMarket(base, NOW), { days: 213, source: 'portal' });
  assert.deepEqual(timeOnMarket({ listedDate: null, firstSeenAt: daysAgo(40) }, NOW), { days: 40, source: 'sighting' });
  assert.equal(timeOnMarket({ listedDate: null, firstSeenAt: null }, NOW), null);
  assert.equal(timeOnMarket({ listedDate: daysAgo(-10), firstSeenAt: null }, NOW), null);
});

test('formatAge: weeks then months, "at least" for our own sighting, nothing under two weeks', () => {
  assert.equal(formatAge({ days: 10, source: 'portal' }, 'purchase'), null);
  assert.equal(formatAge({ days: 14, source: 'portal' }, 'purchase'), '2 weeks');
  assert.equal(formatAge({ days: 55, source: 'portal' }, 'purchase'), '7 weeks');
  assert.equal(formatAge({ days: 213, source: 'portal' }, 'purchase'), '6 months');
  assert.equal(formatAge({ days: 31, source: 'portal' }, 'purchase'), '4 weeks');
  assert.equal(formatAge({ days: 70, source: 'portal' }, 'rent-to-rent'), '10 weeks');
  assert.equal(formatAge({ days: 91, source: 'portal' }, 'rent-to-rent'), '2 months');
  assert.equal(formatAge({ days: 213, source: 'sighting' }, 'purchase'), 'at least 6 months');
  assert.equal(formatAge({ days: 7, source: 'portal' }, 'rent-to-rent'), null);
  assert.equal(formatAge(null, 'purchase'), null);
});

test('reductions: our recorded cuts, with the stored verdict as a floor, rises ignored', () => {
  const cut = (from: number, to: number) => ({ at: NOW.toISOString(), amount: to, period: 'total', status: null, previousAmount: from, previousStatus: null, notified: false });
  assert.equal(reductionCount({ priceHistory: [cut(200, 190), cut(190, 185)], motivation: null }), 2);
  assert.equal(reductionCount({ priceHistory: [cut(190, 200)], motivation: null }), 0);
  assert.equal(reductionCount({ priceHistory: [], motivation: { score: 25, firmScore: 25, fired: ['price_reduced'] } }), 1);
  assert.equal(reductionCount({ priceHistory: [cut(200, 190)], motivation: { score: 40, firmScore: 40, fired: ['reduced_repeatedly'] } }), 2);
  assert.equal(reductionCount({ priceHistory: 'junk', motivation: 'junk' }), 0);
});

test('countWord', () => {
  assert.equal(countWord(0), null);
  assert.equal(countWord(1), 'once');
  assert.equal(countWord(2), 'twice');
  assert.equal(countWord(3), '3 times');
});

test('bedrooms: studio for 0, nothing for unknown or nonsense', () => {
  assert.equal(bedroomsText(0), 'studio');
  assert.equal(bedroomsText(3), '3-bedroom');
  assert.equal(bedroomsText(null), null);
  assert.equal(bedroomsText(-1), null);
  assert.equal(bedroomsText(2.5), null);
});

test('member name: an email address or blank is not a name', () => {
  assert.equal(memberNameText('  Zac  Smith '), 'Zac Smith');
  assert.equal(memberNameText('zac@stayful.co.uk'), null);
  assert.equal(memberNameText(''), null);
  assert.equal(memberNameText(null), null);
});

test('off the market: sold, under offer, let agreed, removed only', () => {
  assert.equal(offMarketReason({ dealStatus: 'retired', retiredReason: 'under_offer' }), 'under_offer');
  assert.equal(offMarketReason({ dealStatus: 'retired', retiredReason: 'stale_listed' }), null);
  assert.equal(offMarketReason({ dealStatus: 'live', retiredReason: 'sold' }), null);
});

test('stale price after a week without a confirmed read', () => {
  assert.equal(priceIsStale({ lastConfirmedAt: daysAgo(8) }, NOW), true);
  assert.equal(priceIsStale({ lastConfirmedAt: daysAgo(2) }, NOW), false);
  assert.equal(priceIsStale({ lastConfirmedAt: null }, NOW), false);
});

test('message fields: kind-specific price, missing facts are null', () => {
  const p = messageFields(base, 'purchase', 'Zac', NOW);
  assert.equal(p.askingPrice, '£185,000');
  assert.equal(p.askingRent, null);
  assert.equal(p.bedrooms, '2-bedroom');
  assert.equal(p.offerAmount, null);
  const r = messageFields({ ...base, kind: 'rent', price: { amount: 1100, period: 'pcm' }, address: null, town: null }, 'rent-to-rent', null, NOW);
  assert.equal(r.askingRent, '£1,100 a month');
  assert.equal(r.askingPrice, null);
  assert.equal(r.address, null);
  assert.equal(r.memberName, null);
});
