import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseDeal, rentToRentDeal, stampDutyAdditional, monthlyMortgage, maxPriceForYield, maxRentForMargin, monthlyCashflow, defaultSetupCost } from './deal.ts';

test('additional-property stamp duty bands', () => {
  assert.equal(stampDutyAdditional(100_000), 5_000);
  assert.equal(stampDutyAdditional(250_000), 6_250 + 8_750);
  assert.equal(stampDutyAdditional(300_000), 6_250 + 8_750 + 5_000);
  assert.equal(stampDutyAdditional(0), 0);
});

test('mortgage payment matches a standard amortisation figure', () => {
  // £165,000 at 5.5% over 25 years ≈ £1,013/month
  const m = monthlyMortgage(165_000, 5.5, 25);
  assert.ok(Math.abs(m - 1013) < 2, `got ${m}`);
  assert.equal(monthlyMortgage(0, 5.5, 25), 0);
  assert.equal(Math.round(monthlyMortgage(12_000, 0, 1)), 1000);
});

test('purchase deal: yields, cash required and target price', () => {
  const d = purchaseDeal(220_000, { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000 });
  assert.equal(d.grossYieldPct, 13.6);
  // net operating = 30000 − 30000·0.48 − 250·12 = 12,600
  assert.equal(d.netOperating, 12_600);
  assert.equal(d.netYieldPct, 5.7);
  assert.equal(d.stampDuty, stampDutyAdditional(220_000));
  assert.equal(d.cashRequired, 55_000 + d.stampDuty + 10_000);
  assert.equal(d.maxPriceForTargetYield, 300_000);
  assert.equal(maxPriceForYield(30_000, 10), 300_000);
  assert.equal(maxPriceForYield(30_000, 0), 0);
  assert.ok(d.mortgageMonthly > 900 && d.mortgageMonthly < 1100);
  const expectedCashflow = 12_600 / 12 - monthlyMortgage(165_000, 5.5, 25);
  assert.ok(Math.abs(d.cashflowMonthly - expectedCashflow) <= 1, `cashflow ${d.cashflowMonthly} vs ${expectedCashflow}`);
  assert.equal(d.cashOnCashPct, Math.round(((d.cashflowMonthly * 12) / d.cashRequired) * 1000) / 10);
});

test('rent-to-rent deal: margin, breakeven, payback, max rent', () => {
  const d = rentToRentDeal(1_200, { grossRevenue: 36_000, adr: 120, bedrooms: 2, setupCost: 8_000 });
  // monthly gross 3000; operating = 3000·0.48 + 250 = 1690; net before rent 1310; margin 110
  assert.equal(d.monthlyGross, 3_000);
  assert.equal(d.monthlyOperating, 1_690);
  assert.equal(d.monthlyNetBeforeRent, 1_310);
  assert.equal(d.monthlyMargin, 110);
  assert.equal(d.annualMargin, 1_320);
  assert.equal(d.paybackMonths, Math.ceil(8_000 / 110));
  assert.equal(d.maxRentForTargetMargin, 810);
  assert.equal(maxRentForMargin(1_310, 2_000), 0);
  // breakeven: (1200+250)·12 / (120·365·0.52) = 17400 / 22776 = 76.4%
  assert.equal(d.breakevenOccupancyPct, 76.4);
  const bad = rentToRentDeal(2_500, { grossRevenue: 36_000, adr: 0, bedrooms: 2 });
  assert.equal(bad.paybackMonths, null);
  assert.equal(bad.breakevenOccupancyPct, null);
  assert.ok(bad.monthlyMargin < 0);
});

test('monthly cashflow flags underwater months', () => {
  const rows = monthlyCashflow([4000, 1000, 2500], 1200);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].net, Math.round(4000 - (4000 * 0.48 + 250) - 1200));
  assert.equal(rows[0].underwater, false);
  assert.equal(rows[1].underwater, true);
  assert.equal(defaultSetupCost(3), 16_500);
});
