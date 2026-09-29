import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleLine, liveSaleReport, refreshedDeal, storedPurchase, workedExamples, type LiveSaleRow } from './mortgage-backfill.ts';
import { purchaseDeal, rentToRentDeal, type PurchaseDeal } from './deal.ts';

const WIDTHS = { high: 10, medium: 15, low: 25 };

/** A deal as the repayment formula saved it, before the type existed. */
function oldRow(price: number, gross: number, bedrooms = 2): PurchaseDeal {
  const d: PurchaseDeal = { ...purchaseDeal(price, { grossRevenue: gross, adr: 0, bedrooms, finance: { mortgageType: 'repayment' } }) };
  delete d.mortgageType;
  return d;
}

test('refreshedDeal: an old row is rewritten once; current rows, rentals and junk are left alone', () => {
  const old = oldRow(220_000, 30_000);
  const fresh = refreshedDeal(old)!;
  assert.ok(fresh);
  assert.equal(fresh.mortgageType, 'interest_only');
  assert.equal(fresh.mortgageMonthly, 756);
  assert.equal(fresh.cashRequired, old.cashRequired);
  // Idempotent: the rewritten row has nothing left to change.
  assert.equal(refreshedDeal(fresh), null);
  assert.equal(refreshedDeal(purchaseDeal(220_000, { grossRevenue: 30_000, adr: 0, bedrooms: 2 })), null);
  assert.equal(refreshedDeal(rentToRentDeal(1_000, { grossRevenue: 30_000, adr: 0, bedrooms: 2 })), null);
  assert.equal(refreshedDeal(null), null);
  assert.equal(refreshedDeal({ kind: 'purchase' }), null, 'an older shape without the figures is skipped');
  assert.equal(storedPurchase({ ...old, netOperating: 'nope' }), null);
});

test('the live-sale report counts cash flow and the profit check both ways, on the cards’ own range', () => {
  const rows: LiveSaleRow[] = [
    // £220k at £30k gross: repayment £37/mo, interest-only £294/mo.
    { area: 'GL', bedrooms: 2, confidence: 'medium', deal: oldRow(220_000, 30_000) },
    // £130k at £30k gross: strongly positive both ways (repayment £452, interest-only £603).
    { area: 'YO', bedrooms: 2, confidence: 'high', deal: oldRow(130_000, 30_000) },
    // £400k at £20k gross: loses money both ways.
    { area: 'BA', bedrooms: 3, confidence: 'low', deal: oldRow(400_000, 20_000) },
    // Not a purchase deal: not counted.
    { area: 'BN', bedrooms: 2, confidence: 'low', deal: rentToRentDeal(1_000, { grossRevenue: 30_000, adr: 0, bedrooms: 2 }) },
  ];
  const r = liveSaleReport(rows, [500, 800, 500], WIDTHS);
  assert.equal(r.deals, 3);
  assert.deepEqual(r.cashflowPositive, { before: 2, after: 2 });
  assert.deepEqual(r.atLeast500, { before: 0, after: 1 });
  assert.deepEqual(r.atLeast1000, { before: 0, after: 0 });
  assert.deepEqual(r.profitCheck.map((c) => c.minProfitPcm), [500, 800], 'each minimum once, in order');
  // The high-confidence £130k deal: interest-only £603 a month, range low £540 at 10%: clears £500, not £800.
  assert.deepEqual(r.profitCheck[0], { minProfitPcm: 500, before: 0, after: 1 });
  assert.deepEqual(r.profitCheck[1], { minProfitPcm: 800, before: 0, after: 0 });
  assert.ok(r.gainPcm && r.gainPcm.min > 0 && r.gainPcm.max >= r.gainPcm.median && r.gainPcm.median >= r.gainPcm.min);
  // No minimum given: the £500 fallback.
  assert.deepEqual(liveSaleReport(rows, [], WIDTHS).profitCheck.map((c) => c.minProfitPcm), [500]);
  assert.equal(liveSaleReport([], [500], WIDTHS).gainPcm, null);
});

test('worked examples: the cheapest, the quartiles, the middle and the dearest, each worked both ways', () => {
  const prices = [130_000, 180_000, 220_000, 330_000, 405_000, 525_000, 2_250_000];
  const rows: LiveSaleRow[] = prices.map((p, i) => ({ area: `A${i}`, bedrooms: 2 + (i % 3), confidence: 'medium', deal: oldRow(p, Math.round(p * 0.25)) }));
  const ex = workedExamples(rows.slice().reverse());
  assert.deepEqual(ex.map((e) => e.price), [130_000, 220_000, 330_000, 525_000, 2_250_000]);
  const first = ex[0];
  assert.equal(first.loan, 97_500);
  assert.equal(first.repaymentPcm, 599);
  assert.equal(first.interestOnlyPcm, 447);
  assert.ok(Math.abs(first.cashflowAfter - first.cashflowBefore - 152) <= 1, `gain ${first.cashflowAfter - first.cashflowBefore}`);
  assert.ok(first.cashOnCashAfter > first.cashOnCashBefore);
  assert.match(first.mostYouCanPayAfter, /^£[\d,]+$/);
  assert.ok(Number(first.mostYouCanPayAfter.replace(/[£,]/g, '')) > Number(first.mostYouCanPayBefore.replace(/[£,]/g, '')));
  assert.match(exampleLine(first), /^A0 · 2 bed · £130,000: loan £97,500, repayment £599\/mo → interest-only £447\/mo; cash flow /);
  // Fewer than five deals: no duplicates.
  assert.deepEqual(workedExamples(rows.slice(0, 2)).map((e) => e.price), [130_000, 180_000]);
  assert.deepEqual(workedExamples([]), []);
  // A deal whose income cannot reach the minimum at any price says so on "most you can pay".
  const losing = workedExamples([{ area: 'TW', bedrooms: 4, confidence: 'low', deal: oldRow(2_250_000, 12_000) }])[0];
  assert.equal(losing.mostYouCanPayBefore, 'none');
  assert.equal(losing.mostYouCanPayAfter, 'none');
});
