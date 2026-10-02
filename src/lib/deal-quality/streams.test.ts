import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashLine, DAY_STREAMS, derivedStreamOfRow, isCheapPrice, isStream, lenderNote, perStream, shortMoney, streamFor, streamOfRow, STREAMS } from './streams.ts';
import { DEFAULT_LOW_ENTRY } from './config.ts';
import { auctionDeal, purchaseDeal, rentToRentDeal } from '../listing/deal.ts';

const base = { grossRevenue: 24_000, adr: 110, bedrooms: 2 };

test('a rental is rent-to-rent; a sale is low entry on its asking price (Batch 22c: at most £150,000), else a top-area deal', () => {
  assert.equal(streamFor('rent', rentToRentDeal(950, base), DEFAULT_LOW_ENTRY), 'r2r');
  assert.equal(streamFor('rent', null, DEFAULT_LOW_ENTRY), 'r2r');
  assert.equal(DEFAULT_LOW_ENTRY.cheapMaxPrice, 150_000);
  assert.equal(streamFor('sale', purchaseDeal(149_999, base), DEFAULT_LOW_ENTRY), 'low_entry');
  assert.equal(streamFor('sale', purchaseDeal(150_000, base), DEFAULT_LOW_ENTRY), 'low_entry', 'the bar itself is cheap');
  assert.equal(streamFor('sale', purchaseDeal(150_001, base), DEFAULT_LOW_ENTRY), 'top60');
  // The cash in no longer decides: £150,000, 2 bed needs £37,500 + SDLT £7,500 + setup £13,000 = £58,000, over the old £50,000 bar.
  assert.ok(purchaseDeal(150_000, base).cashRequired > DEFAULT_LOW_ENTRY.maxCashIn);
  assert.equal(streamFor('sale', null, DEFAULT_LOW_ENTRY), 'top60', 'no deal figure is never low entry');
  assert.equal(streamFor('sale', purchaseDeal(120_000, base), { cheapMaxPrice: 100_000 }), 'top60', 'the bar is the setting');
  assert.ok(isCheapPrice(1, DEFAULT_LOW_ENTRY) && !isCheapPrice(0, DEFAULT_LOW_ENTRY) && !isCheapPrice(null, DEFAULT_LOW_ENTRY) && !isCheapPrice(Number.NaN, DEFAULT_LOW_ENTRY));
});

test('an auction lot is judged on its auction price (the guide plus the usual 15%), never its guide or its bridging cash', () => {
  // Guide £130,000 → £149,500 at auction: cheap, though the bridging cash is over £80,000.
  const lot = auctionDeal(130_000, 'modern', { grossRevenue: 35_000, adr: 120, bedrooms: 4 });
  assert.equal(lot.askingPrice, 149_500);
  assert.ok(lot.cashRequired > 80_000, `${lot.cashRequired}`);
  assert.equal(streamFor('sale', lot, DEFAULT_LOW_ENTRY), 'low_entry');
  // Guide £135,000 is within £150,000, but £155,250 at auction is not.
  const over = auctionDeal(135_000, 'traditional', base);
  assert.equal(over.askingPrice, 155_250);
  assert.equal(streamFor('sale', over, DEFAULT_LOW_ENTRY), 'top60');
});

test('a stored row keeps its stream column, or is worked out from the deal it carries', () => {
  assert.equal(streamOfRow({ kind: 'sale', stream: 'low_entry', deal: null }, DEFAULT_LOW_ENTRY), 'low_entry');
  assert.equal(streamOfRow({ kind: 'sale', stream: 'junk', deal: { kind: 'purchase', askingPrice: 140_000, cashRequired: 60_000 } }, DEFAULT_LOW_ENTRY), 'low_entry', 'an unknown value falls back to the deal');
  assert.equal(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', askingPrice: 260_000, cashRequired: 40_000 } }, DEFAULT_LOW_ENTRY), 'top60', 'a small cash in is no longer enough');
  assert.equal(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', askingPrice: 'abc' } }, DEFAULT_LOW_ENTRY), 'top60');
  assert.equal(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', askingPrice: null } }, DEFAULT_LOW_ENTRY), 'top60');
  assert.equal(streamOfRow({ kind: 'rent', deal: null }, DEFAULT_LOW_ENTRY), 'r2r');
  assert.deepEqual(STREAMS, ['top60', 'low_entry', 'r2r', 'project']);
  assert.equal(streamOfRow({ kind: 'sale', stream: 'project', deal: null }, DEFAULT_LOW_ENTRY), 'project', 'Batch 17: set only by the Project hold, kept from the column');
  assert.equal(derivedStreamOfRow({ kind: 'sale', deal: { kind: 'purchase', askingPrice: 120_000 } }, DEFAULT_LOW_ENTRY), 'low_entry');
  assert.ok(isStream('r2r') && !isStream('R2R') && !isStream(null));
});

test('Batch 22c, Part E: the lender note under £75,000, never for a cash buyer, never at or over it', () => {
  assert.equal(DEFAULT_LOW_ENTRY.lenderMinPrice, 75_000);
  assert.equal(lenderNote(74_999, DEFAULT_LOW_ENTRY), "Some lenders won't lend under about £75k. Check with a broker, or plan it as a cash buy.");
  assert.equal(lenderNote(75_000, DEFAULT_LOW_ENTRY), null);
  assert.equal(lenderNote(74_999, DEFAULT_LOW_ENTRY, true), null, 'a cash buyer borrows nothing');
  assert.equal(lenderNote(null, DEFAULT_LOW_ENTRY), null);
  assert.equal(lenderNote(0, DEFAULT_LOW_ENTRY), null);
  assert.equal(lenderNote(55_000, { lenderMinPrice: 60_000 }), "Some lenders won't lend under about £60k. Check with a broker, or plan it as a cash buy.", 'the figure is the setting');
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

test('Batch 17: the day’s checks are shared by Batch 16’s three streams; the Project stream counts on its own', () => {
  assert.deepEqual(DAY_STREAMS, ['top60', 'low_entry', 'r2r']);
  assert.deepEqual(perStream(() => 0), { top60: 0, low_entry: 0, r2r: 0, project: 0 });
  assert.deepEqual(perStream((s) => s.length), { top60: 5, low_entry: 9, r2r: 3, project: 7 });
  // The record never puts a deal in the Project stream: only the hold does.
  assert.notEqual(streamOfRow({ kind: 'sale', deal: { kind: 'purchase', askingPrice: 90_000 } }, { cheapMaxPrice: 150_000 }), 'project');
  assert.equal(streamOfRow({ kind: 'sale', stream: 'project', deal: null }, { cheapMaxPrice: 150_000 }), 'project');
});
