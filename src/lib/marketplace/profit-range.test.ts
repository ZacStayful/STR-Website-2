import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profitRange, formatRange, widthFor, upliftTag, cardRangeLine, rangeCaption } from './profit-range.ts';
import { purchaseDeal, rentToRentDeal } from '../listing/deal.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };

test('rent-to-rent: the margin after rent at the model the Full analysis uses, ±15% at medium confidence', () => {
  const r = profitRange({ kind: 'rent', priceAmount: 1200, pricePeriod: 'pcm', bedrooms: 2, grossRevenue: 40_000, confidence: 'medium', widths: WIDTHS });
  assert.ok(r);
  const mid = rentToRentDeal(1200, { grossRevenue: 40_000, adr: 0, bedrooms: 2 }).monthlyMargin;
  assert.equal(r!.midPcm, Math.round(mid));
  assert.equal(r!.lowPcm, Math.round((mid * 0.85) / 10) * 10);
  assert.equal(r!.highPcm, Math.round((mid * 1.15) / 10) * 10);
  assert.equal(r!.kind, 'rent-to-rent');
  assert.match(r!.label, /^£[\d,]+–£[\d,]+\/mo$/);
});

test('a purchase: cash flow after the mortgage, at the member’s own deposit and rate', () => {
  const house = profitRange({ kind: 'sale', priceAmount: 200_000, pricePeriod: 'total', bedrooms: 2, grossRevenue: 36_000, confidence: 'low', widths: WIDTHS })!;
  const mine = profitRange({ kind: 'sale', priceAmount: 200_000, pricePeriod: 'total', bedrooms: 2, grossRevenue: 36_000, confidence: 'low', finance: { depositPct: 40, mortgageRatePct: 4 }, widths: WIDTHS })!;
  assert.equal(house.midPcm, purchaseDeal(200_000, { grossRevenue: 36_000, adr: 0, bedrooms: 2 }).cashflowMonthly);
  // A bigger deposit at a lower rate means a smaller mortgage and more cash flow.
  assert.ok(mine.midPcm > house.midPcm);
  assert.equal(house.basis, 'cash flow after the mortgage');
});

test('never wider than ±25%, whatever the setting says', () => {
  assert.equal(widthFor('low', { high: 10, medium: 15, low: 40 }), 25);
  assert.equal(widthFor(null, WIDTHS), 25);
  assert.equal(widthFor('high', WIDTHS), 10);
});

test('a negative range reads with a proper minus and "to"', () => {
  assert.equal(formatRange(-150, 50), '−£150 to £50/mo');
  assert.equal(formatRange(-300, -120), '−£300 to −£120/mo');
  assert.equal(formatRange(450, 700), '£450–£700/mo');
  assert.equal(formatRange(1200, 1850), '£1,200–£1,850/mo');
});

test('a deal that breaks even is still a range', () => {
  // Find a rent where the margin is ~0 for this revenue.
  const r = profitRange({ kind: 'rent', priceAmount: 1, pricePeriod: 'pcm', bedrooms: 1, grossRevenue: 6_700, confidence: 'high', widths: WIDTHS })!;
  assert.ok(r.highPcm - r.lowPcm >= 10);
});

test('no revenue or no price: no range rather than a made-up one', () => {
  assert.equal(profitRange({ kind: 'sale', priceAmount: null, pricePeriod: 'total', bedrooms: 2, grossRevenue: 30_000, confidence: 'medium', widths: WIDTHS }), null);
  assert.equal(profitRange({ kind: 'rent', priceAmount: 1000, pricePeriod: 'pcm', bedrooms: 2, grossRevenue: null, confidence: 'medium', widths: WIDTHS }), null);
  assert.equal(profitRange({ kind: 'rent', priceAmount: 1000, pricePeriod: 'total', bedrooms: 2, grossRevenue: 30_000, confidence: 'medium', widths: WIDTHS }), null);
});

test('a weekly rent is taken per calendar month; stored numbers can arrive as strings', () => {
  const weekly = profitRange({ kind: 'rent', priceAmount: '300', pricePeriod: 'pw', bedrooms: 2, grossRevenue: '40000', confidence: 'medium', widths: WIDTHS })!;
  const monthly = profitRange({ kind: 'rent', priceAmount: 1300, pricePeriod: 'pcm', bedrooms: 2, grossRevenue: 40_000, confidence: 'medium', widths: WIDTHS })!;
  assert.equal(weekly.midPcm, monthly.midPcm);
});

test('the long-let uplift tag', () => {
  assert.equal(upliftTag(45.2), '+45% vs a long let');
  assert.equal(upliftTag('-12'), '−12% vs a long let');
  assert.equal(upliftTag(null), null);
});

test('other income-dependent figures get the same width', async () => {
  const { spread, moneyRange } = await import('./profit-range.ts');
  assert.deepEqual(spread(7.2, 15, 0.1).map((n) => Math.round(n * 10) / 10), [6.1, 8.3]);
  assert.deepEqual(spread(20_000, 15, 100), [17_000, 23_000]);
  assert.deepEqual(spread(20_000, 60, 100), [15_000, 25_000]);
  assert.equal(moneyRange([17_000, 23_000]), '£17,000–£23,000');
  assert.equal(moneyRange([-1_200, 300]), '−£1,200 to £300');
});

test('the email line carries the cash in / to start when the card row has it (Batch 16)', () => {
  const sale = { kind: 'sale' as const, price_amount: 120_000, price_period: 'total', bedrooms: 2, screening_gross: 30_000, screening_confidence: 'medium' };
  const plain = cardRangeLine(sale, null, WIDTHS);
  assert.ok(plain && plain.endsWith('/mo · area estimate'), plain ?? 'null');
  assert.equal(cardRangeLine({ ...sale, deal_cash: '49000' }, null, WIDTHS), `${plain} · £49k cash in`);
  const rent = { kind: 'rent' as const, price_amount: 1_200, price_period: 'pcm', bedrooms: 2, screening_gross: 40_000, screening_confidence: 'medium', deal_setup: 13_000 };
  const line = cardRangeLine(rent, null, WIDTHS);
  assert.ok(line && line.endsWith('/mo · area estimate · £13k to start'), line ?? 'null');
  assert.equal(cardRangeLine({ ...sale, screening_gross: null, deal_cash: '49000' }, null, WIDTHS), null, 'no range, no line');
});

// ── Batch 16, Part C: the caption says what the range rests on ──

test('the caption: the deal’s own comparables once checked (the count only), else the area estimate', () => {
  assert.equal(rangeCaption(null), 'area estimate');
  assert.equal(rangeCaption(0), 'area estimate');
  assert.equal(rangeCaption(12), 'based on 12 similar Airbnbs nearby');
  assert.equal(rangeCaption('8'), 'based on 8 similar Airbnbs nearby');
  assert.equal(rangeCaption(1), 'based on 1 similar Airbnb nearby');
  const line = cardRangeLine({ kind: 'sale', price_amount: 250_000, price_period: 'total', bedrooms: 3, screening_gross: 48_000, screening_confidence: 'high', deal_cash: 78_000, check_comps: 12 }, null, { high: 10, medium: 15, low: 25 });
  assert.ok(line?.includes(' · based on 12 similar Airbnbs nearby · £78k cash in'), line ?? 'no line');
  const before = cardRangeLine({ kind: 'sale', price_amount: 250_000, price_period: 'total', bedrooms: 3, screening_gross: 48_000, screening_confidence: 'medium', deal_cash: 78_000 }, null, { high: 10, medium: 15, low: 25 });
  assert.ok(before?.includes(' · area estimate · £78k cash in'), before ?? 'no line');
});
