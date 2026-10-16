import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysedPrice, btlInsteadFor, rentFromLongLet } from './analyser.ts';
import type { AnalysisResult } from '../types.ts';

const longLet = { monthlyRent: 1_200, estimateLow: 1_150, estimateHigh: 1_250, comparables: [] };

test('the report’s own long-let valuation as a rent range: never narrower than ±10%', () => {
  assert.deepEqual([rentFromLongLet(longLet)!.low, rentFromLongLet(longLet)!.mid, rentFromLongLet(longLet)!.high], [1_080, 1_200, 1_320]);
  assert.deepEqual([rentFromLongLet({ ...longLet, estimateLow: 900, estimateHigh: 1_500 })!.low, rentFromLongLet({ ...longLet, estimateLow: 900, estimateHigh: 1_500 })!.high], [900, 1_500], 'a wider valuation range is kept');
  assert.equal(rentFromLongLet({ ...longLet, monthlyRent: 0 }), null);
  assert.equal(rentFromLongLet(null), null);
});

test('the price it is worked at: the asking price, then the listing’s, then the valuation', () => {
  assert.equal(analysedPrice({ deal: { kind: 'purchase', askingPrice: 160_000 } as never, sourceListing: null, propertyValuation: null }), 160_000);
  assert.equal(analysedPrice({ deal: null, sourceListing: { url: 'x', source: 'rightmove', kind: 'sale', price: { amount: 150_000, period: 'total' } }, propertyValuation: null }), 150_000);
  assert.equal(analysedPrice({ deal: null, sourceListing: null, propertyValuation: { estimatedValue: 140_000 } as never }), 140_000);
  assert.equal(analysedPrice({ deal: null, sourceListing: null, propertyValuation: null }), null);
});

test('"Buy to let instead?": the buy-to-let figures on the report’s own data; nothing without a price or a rent', () => {
  const r = { property: { address: '1 High St', postcode: 'B44 9AA', bedrooms: 3, guests: 6 }, longLet, deal: { kind: 'purchase', askingPrice: 160_000, mortgageRateLive: { ratePct: 5.13, product: '2-year fixed', date: 'Sep 2026' } }, epc: { rating: 'd' }, growth: { outcode: 'B44', region: 'west_midlands', growth5y: 28.9, growth1y: 3.9, asOf: '2026-09-27' } } as unknown as AnalysisResult;
  const card = btlInsteadFor(r)!;
  assert.equal(card.price, 160_000);
  assert.equal(card.ratePct, 5.13);
  assert.equal(card.rateFallback, false);
  assert.equal(card.flags.epc, 'D');
  assert.equal(card.rentTest.requiredRent, 891);
  assert.ok(card.growth && card.growth.value5y.low > 160_000);
  assert.ok(!JSON.stringify(card).includes('High St') && !JSON.stringify(card).includes('B44 9AA'), 'no address or full postcode');
  assert.equal(btlInsteadFor({ ...r, longLet: { ...longLet, monthlyRent: 0 } }), null);
  assert.equal(btlInsteadFor({ ...r, deal: null }), null);
});
