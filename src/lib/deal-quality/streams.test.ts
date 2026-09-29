import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashLine, isStream, shortMoney, streamFor, streamOfRow, STREAMS } from './streams.ts';
import { DEFAULT_LOW_ENTRY } from './config.ts';
import { auctionDeal, purchaseDeal, rentToRentDeal } from '../listing/deal.ts';

const base = { grossRevenue: 24_000, adr: 110, bedrooms: 2 };

test('a rental is rent-to-rent; a sale is low entry on the house cash in, else a top-area deal', () => {
  assert.equal(streamFor('rent', rentToRentDeal(950, base), DEFAULT_LOW_ENTRY), 'r2r');
  assert.equal(streamFor('rent', null, DEFAULT_LOW_ENTRY), 'r2r');
  // £120,000, 2 bed, England: 25% deposit £30,000 + SDLT £6,000 + setup £13,000 = £49,000.
  const cheap = purchaseDeal(120_000, base);
  assert.equal(cheap.cashRequired, 49_000);
  assert.equal(streamFor('sale', cheap, DEFAULT_LOW_ENTRY), 'low_entry');
  // £124,000: £31,000 + £6,200 + £13,000 = £50,200, just over.
  assert.equal(streamFor('sale', purchaseDeal(124_000, base), DEFAULT_LOW_ENTRY), 'top60');
  assert.equal(streamFor('sale', null, DEFAULT_LOW_ENTRY), 'top60', 'no deal figure is never low entry');
  assert.equal(streamFor('sale', cheap, { maxCashIn: 40_000 }), 'top60', 'the bar is the setting');
});

test('an auction lot is judged on its auction cash: Mossford (guide £130,000, 4 bed) is not low entry', () => {
  const lot = auctionDeal(130_000, 'modern', { grossRevenue: 35_000, adr: 120, bedrooms: 4 });
  assert.ok(lot.cashRequired > 80_000, `${lot.cashRequired}`);
  assert.equal(streamFor('sale', lot, DEFAULT_LOW_ENTRY), 'top60');
  // A cheap lot on a traditional room: guide £50,000 → £57,500, 30% deposit £17,250, SDLT £2,875, premium £1,500, fees £2,805, setup £13,000.
  const cheapLot = auctionDeal(50_000, 'traditional', base);
  assert.ok(cheapLot.cashRequired < 50_000, `${cheapLot.cashRequired}`);
  assert.equal(streamFor('sale', cheapLot, DEFAULT_LOW_ENTRY), 'low_entry');
});

test('a stored row keeps its stream column, or is worked out from the deal it carries', () => {
  assert.equal(streamOfRow({ kind: 'sale', stream: 'low_entry', deal: null }, DEFAULT_LOW_ENTRY), 'low_entry');
  assert.equal(streamOfRow({ kind: 'sale', stream: 'junk', deal: { kind: 'purchase', cashRequired: 40_000 } }, DEFAULT_LOW_ENTRY), 'low_entry', 'an unknown value falls back to the deal');
  assert.equal(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', cashRequired: 99_000 } }, DEFAULT_LOW_ENTRY), 'top60');
  assert.equal(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', cashRequired: 'abc' } }, DEFAULT_LOW_ENTRY), 'top60');
  assert.equal(streamOfRow({ kind: 'rent', deal: null }, DEFAULT_LOW_ENTRY), 'r2r');
  assert.deepEqual(STREAMS, ['top60', 'low_entry', 'r2r']);
  assert.ok(isStream('r2r') && !isStream('R2R') && !isStream(null));
});

test('"£38k cash in" and "£12k to start", to the nearest thousand', () => {
  assert.equal(shortMoney(38_250), '£38k');
  assert.equal(shortMoney(9_500), '£9.5k');
  assert.equal(shortMoney(13_000), '£13k');
  assert.equal(shortMoney(1_250_000), '£1.3m');
  assert.equal(shortMoney(640), '£640');
  assert.equal(cashLine('sale', 38_250), '£38k cash in');
  assert.equal(cashLine('sale', '85000'), '£85k cash in');
  assert.equal(cashLine('rent', 13_000), '£13k to start');
  assert.equal(cashLine('sale', null), null);
  assert.equal(cashLine('sale', 0), null);
  assert.equal(cashLine('rent', 'abc'), null);
});
