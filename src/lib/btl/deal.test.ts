import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandTop, btlDeal, cashBandFor, epcAllowanceFor, inBudget, lenderRentTest, monthlyCostsAt, stressRatePct, type BtlInputs } from './deal.ts';
import { flatCharges } from './listing.ts';
import { growthRange } from './growth.ts';

// The four worked examples in the Batch 28 plan: real live listings on
// 16 Oct 2026, at the live 2-year fix of 5.13%, England, no EPC checked.
const ENGLAND: BtlInputs = { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: null };

test('B44 Birmingham, 3-bed terrace, £160,000: every figure as a range (income example)', () => {
  const d = btlDeal(160_000, { low: 1_198, mid: 1_331, high: 1_464 }, ENGLAND);
  assert.ok(d);
  assert.equal(d.loan, 120_000);
  assert.equal(d.mortgageMonthly, 513);
  assert.deepEqual(d.monthlyCosts, { low: 369, mid: 405, high: 440 });
  assert.deepEqual(d.cashflowMonthly, { low: 316, mid: 413, high: 511 });
  assert.deepEqual(d.cashIn, { low: 51_200, mid: 51_200, high: 56_200 });
  assert.equal(d.tax, 8_700);
  assert.equal(d.taxName, 'SDLT');
  assert.equal(d.epcAllowance, 5_000, 'an unchecked EPC carries the D allowance on the high end');
  assert.deepEqual(d.roiPct, { low: 6.7, mid: 9.7, high: 12 });
  assert.deepEqual(d.grossYieldPct, { low: 9, mid: 10, high: 11 });
  assert.deepEqual(d.netYieldPct, { low: 6.2, mid: 6.9, high: 7.7 });
  assert.equal(d.rentTest.pass, true);
  assert.equal(d.rentTest.requiredRent, 891);
  assert.equal(d.rentTest.stressRatePct, 7.13);
  assert.equal(d.rentTest.depositPctToPass, null);
});

test('CH41 Birkenhead, 2-bed terrace, £102,500 (growth example)', () => {
  const d = btlDeal(102_500, { low: 651, mid: 814, high: 977 }, ENGLAND);
  assert.ok(d);
  assert.equal(d.mortgageMonthly, 329);
  assert.deepEqual(d.cashflowMonthly, { low: 99, mid: 218, high: 338 });
  assert.deepEqual(d.cashIn, { low: 33_250, mid: 33_250, high: 38_250 });
  assert.deepEqual(d.roiPct, { low: 3.1, mid: 7.9, high: 12.2 });
  assert.equal(d.rentTest.requiredRent, 571);
  assert.equal(d.rentTest.pass, true);
  const g = growthRange(102_500, 24.2, 4.2, 'CH41', '2026-09-27');
  assert.ok(g);
  assert.deepEqual(g.annualPct, { low: 2.21, mid: 3.32, high: 4.43 });
  assert.equal(g.value5y.low, 114_365);
  assert.equal(g.value5y.high, 127_305);
  assert.equal(g.growth1yPct, 4.2);
  assert.equal(g.turning, false);
});

test('ST1 Stoke, 2-bed terrace, £83,000 (a bit of both example)', () => {
  const d = btlDeal(83_000, { low: 702, mid: 780, high: 858 }, ENGLAND);
  assert.ok(d);
  assert.equal(d.mortgageMonthly, 266);
  assert.deepEqual(d.cashflowMonthly, { low: 199, mid: 256, high: 313 });
  assert.deepEqual(d.cashIn, { low: 27_400, mid: 27_400, high: 32_400 });
  assert.deepEqual(d.roiPct, { low: 7.4, mid: 11.2, high: 13.7 });
  assert.equal(d.rentTest.requiredRent, 462);
});

test('CA2 Carlisle, 3-bed semi, £180,000 fails the lender test, and says what deposit would pass', () => {
  const d = btlDeal(180_000, { low: 846, mid: 940, high: 1_034 }, ENGLAND);
  assert.ok(d);
  assert.deepEqual(d.cashflowMonthly, { low: -7, mid: 62, high: 131 });
  assert.deepEqual(d.roiPct, { low: -0.1, mid: 1.3, high: 2.7 });
  assert.equal(d.tax, 10_100);
  assert.equal(d.rentTest.pass, false);
  assert.equal(d.rentTest.requiredRent, 1_003);
  assert.equal(d.rentTest.depositPctToPass, 30);
  assert.equal(d.rentTest.depositToPass, 54_000);
});

test('the lender test: the higher of the live rate + 2% or 5.5%, 125% cover, at 75% LTV', () => {
  assert.equal(stressRatePct(5.13), 7.13);
  assert.equal(stressRatePct(3), 5.5, 'the floor holds when rates are low');
  const t = lenderRentTest(1_000, 150_000, 3);
  assert.ok(t);
  // 150,000 × 1.25 × 5.5% ÷ 12 = £859.38
  assert.equal(t.requiredRent, 859);
  assert.equal(t.pass, true);
  assert.equal(lenderRentTest(Number.NaN, 150_000, 3), null);
  assert.equal(lenderRentTest(1_000, 0, 3), null);
});

test('each nation pays its own tax on the purchase, from the one helper', () => {
  const at = (country: BtlInputs['country']) => btlDeal(100_000, { low: 900, mid: 1_000, high: 1_100 }, { ...ENGLAND, country })!;
  assert.equal(at('england').tax, 5_000);
  assert.equal(at('northern_ireland').tax, 5_000);
  assert.equal(at('wales').tax, 5_000);
  assert.equal(at('wales').taxName, 'LTT');
  assert.equal(at('scotland').tax, 8_000, 'LBTT nil band plus the 8% ADS');
  assert.equal(at('scotland').taxName, 'LBTT');
  assert.equal(at('scotland').cashIn.mid, 25_000 + 8_000 + 2_500);
  assert.equal(btlDeal(220_000, { low: 900, mid: 1_000, high: 1_100 }, { ...ENGLAND, country: 'wales' })!.tax, 9_000 + 3_400);
});

test('running costs: one empty month, agent and repairs on the rent collected, insurance and certificates', () => {
  const c = monthlyCostsAt(1_200, 0, 0);
  assert.equal(Math.round(c.emptyMonths), 100);
  assert.equal(Math.round(c.agent), 132);
  assert.equal(Math.round(c.repairs), 88);
  assert.equal(c.insurance, 25);
  assert.equal(c.safety, 25);
  assert.equal(Math.round(c.total), 370);
});

test('a flat without a listed service charge carries the estimate, widest against the low end', () => {
  const flat = flatCharges('flat', {}, false);
  assert.ok(flat);
  assert.equal(flat.confirmed, false);
  assert.deepEqual(flat.serviceCharge, { low: 900, mid: 1_500, high: 2_100 });
  const d = btlDeal(100_000, { low: 900, mid: 1_000, high: 1_100 }, { ...ENGLAND, flat })!;
  const house = btlDeal(100_000, { low: 900, mid: 1_000, high: 1_100 }, ENGLAND)!;
  assert.equal(d.costLines.serviceCharge, 125);
  assert.equal(d.costLines.groundRent, 13);
  assert.equal(house.cashflowMonthly.low - d.cashflowMonthly.low, 200, 'the low end carries the high charges: (2,100 + 300) ÷ 12');
  assert.equal(house.cashflowMonthly.high - d.cashflowMonthly.high, 75, 'the high end the low charges: 900 ÷ 12');
  const listed = flatCharges('flat', { serviceChargeYear: 1_200, groundRentYear: 0 }, false)!;
  assert.equal(listed.confirmed, true);
  assert.deepEqual(listed.serviceCharge, { low: 1_200, mid: 1_200, high: 1_200 });
  assert.equal(flatCharges('house', {}, false), null);
  assert.equal(flatCharges('flat', {}, true)!.serviceCharge.mid, 2_500, 'London');
});

test('the EPC allowance sits on the high end of cash in only', () => {
  assert.equal(epcAllowanceFor('C'), 0);
  assert.equal(epcAllowanceFor('D'), 5_000);
  assert.equal(epcAllowanceFor('F'), 10_000);
  assert.equal(epcAllowanceFor(null), 5_000);
  const d = btlDeal(100_000, { low: 900, mid: 1_000, high: 1_100 }, { ...ENGLAND, epc: 'B' })!;
  assert.equal(d.cashIn.low, d.cashIn.high);
});

test('the live rate falls back, and says so, when none is cached', () => {
  const d = btlDeal(100_000, { low: 900, mid: 1_000, high: 1_100 }, { ...ENGLAND, ratePct: null })!;
  assert.equal(d.rateFallback, true);
  assert.equal(d.ratePct, 5.5);
});

test('missing or broken figures return null, never throw', () => {
  assert.equal(btlDeal(0, { low: 1, mid: 2, high: 3 }, ENGLAND), null);
  assert.equal(btlDeal(100_000, null, ENGLAND), null);
  assert.equal(btlDeal(100_000, { low: Number.NaN, mid: 2, high: 3 }, ENGLAND), null);
  assert.equal(growthRange(100_000, null, null, 'X1', null), null);
});

test('cash bands: the middle cash in against the top of the member’s band', () => {
  assert.equal(cashBandFor(24_999), 'under_25k');
  assert.equal(cashBandFor(25_000), '25k_50k');
  assert.equal(cashBandFor(51_200), '50k_100k');
  assert.equal(cashBandFor(100_000), '100k_plus');
  assert.equal(cashBandFor(Number.NaN), null);
  assert.equal(bandTop('25k_50k'), 50_000);
  assert.equal(bandTop('100k_plus'), Number.POSITIVE_INFINITY);
  assert.equal(inBudget(27_400, '25k_50k'), true);
  assert.equal(inBudget(51_200, '25k_50k'), false);
  assert.equal(inBudget(27_400, 'under_25k'), false);
});

test('a market that has turned is visible: the 1-year figure fell while the five years rose', () => {
  const g = growthRange(100_000, 12, -3.1, 'YO10', null)!;
  assert.equal(g.turning, true);
  const falling = growthRange(100_000, -9.5, -16.8, 'SE11', null)!;
  assert.ok(falling.annualPct.low < 0 && falling.annualPct.high === 0, 'falling history: the repeat is the low end, the top holds flat');
});
