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
  assert.equal(d.depositPct, 25);
  const custom = purchaseDeal(220_000, { grossRevenue: 30_000, adr: 150, bedrooms: 2, finance: { depositPct: 40, mortgageRatePct: 4, termYears: 20 } });
  assert.equal(custom.depositPct, 40);
  assert.equal(custom.mortgageRatePct, 4);
  assert.ok(custom.mortgageMonthly < d.mortgageMonthly);
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

test('stamp duty: the calculator figure is used verbatim, otherwise the nation\'s own bands', () => {
  const base = { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000 };
  const live = purchaseDeal(220_000, { ...base, stampDuty: { amount: 12_345, name: 'SDLT', effectiveRatePct: 5.6, country: 'england', source: 'propertydata' } });
  assert.equal(live.stampDuty, 12_345);
  assert.equal(live.stampDutySource, 'propertydata');
  assert.equal(live.stampDutyName, 'SDLT');
  assert.equal(live.cashRequired, 55_000 + 12_345 + 10_000);
  const wales = purchaseDeal(220_000, { ...base, country: 'wales' });
  assert.equal(wales.stampDutyName, 'LTT');
  assert.equal(wales.stampDutySource, 'local');
  assert.equal(wales.stampDuty, 9_000 + 3_400);
  const scotland = purchaseDeal(250_000, { ...base, country: 'scotland' });
  assert.equal(scotland.stampDuty, 22_100);
  assert.equal(scotland.taxCountry, 'scotland');
  // A deal with no nation is England, as before.
  const plain = purchaseDeal(220_000, base);
  assert.equal(plain.stampDuty, stampDutyAdditional(220_000));
  assert.equal(plain.taxCountry, 'england');
});

test('bills: the council tax split feeds the running costs, and an explicit bills field still wins', () => {
  const base = { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000 };
  const ct = { band: 'E' as const, annual: 1857.18, council: 'Test', year: '2026/27', matched: 'address' as const };
  const bills = { billsPcm: 275, councilTaxPcm: 155, utilitiesPcm: 120, councilTax: ct };
  const d = purchaseDeal(220_000, { ...base, bills });
  // net operating = 30000 − 30000·0.48 − 275·12 = 12,300
  assert.equal(d.netOperating, 12_300);
  assert.equal(d.billsPcm, 275);
  assert.equal(d.councilTax?.band, 'E');
  const edited = purchaseDeal(220_000, { ...base, bills, costs: { billsPcm: 300 } });
  assert.equal(edited.netOperating, 12_000);
  assert.equal(edited.billsPcm, 300);
  const r2r = rentToRentDeal(1_200, { ...base, grossRevenue: 36_000, adr: 120, setupCost: 8_000, bills });
  // operating = 3000·0.48 + 275 = 1715
  assert.equal(r2r.monthlyOperating, 1_715);
  assert.equal(r2r.billsPcm, 275);
  assert.equal(r2r.councilTax?.band, 'E');
  const rows = monthlyCashflow([4000], 1200, { billsPcm: 275 });
  assert.equal(rows[0].operating, Math.round(4000 * 0.48 + 275));
});

test('the mortgage rate records where it came from', () => {
  const base = { grossRevenue: 30_000, adr: 150, bedrooms: 2 };
  const live = purchaseDeal(220_000, { ...base, finance: { mortgageRatePct: 5.29 }, mortgageRate: { source: 'live', live: { ratePct: 5.29, product: '3-year fixed', date: 'Jun 2023' } } });
  assert.equal(live.mortgageRatePct, 5.29);
  assert.equal(live.mortgageRateSource, 'live');
  assert.equal(live.mortgageRateLive?.product, '3-year fixed');
  const plain = purchaseDeal(220_000, base);
  assert.equal(plain.mortgageRateSource, undefined);
  assert.equal(plain.mortgageRateLive, null);
});
