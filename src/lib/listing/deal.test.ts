import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseDeal, auctionDeal, rentToRentDeal, stampDutyAdditional, monthlyMortgage, interestOnlyMortgage, mortgagePayment, maxPriceForYield, maxPriceForProfit, maxRentForMargin, monthlyCashflow, defaultSetupCost, atCurrentMortgage, MORTGAGE_NOTE, DEFAULT_FINANCE, type Deal, type PurchaseDeal } from './deal.ts';

test('additional-property stamp duty bands', () => {
  assert.equal(stampDutyAdditional(100_000), 5_000);
  assert.equal(stampDutyAdditional(250_000), 6_250 + 8_750);
  assert.equal(stampDutyAdditional(300_000), 6_250 + 8_750 + 5_000);
  assert.equal(stampDutyAdditional(0), 0);
});

test('repayment mortgage payment matches a standard amortisation figure (kept behind the setting)', () => {
  // £165,000 at 5.5% over 25 years ≈ £1,013/month
  const m = monthlyMortgage(165_000, 5.5, 25);
  assert.ok(Math.abs(m - 1013) < 2, `got ${m}`);
  assert.equal(monthlyMortgage(0, 5.5, 25), 0);
  assert.equal(Math.round(monthlyMortgage(12_000, 0, 1)), 1000);
});

// ── Batch 16b: interest-only is the house mortgage ──

test('interest-only payment is the loan times the rate over twelve, and the setting picks the formula', () => {
  assert.equal(interestOnlyMortgage(165_000, 5.5), 756.25);
  assert.equal(interestOnlyMortgage(0, 5.5), 0);
  assert.equal(interestOnlyMortgage(-1, 5.5), 0);
  assert.equal(interestOnlyMortgage(165_000, 0), 0);
  assert.equal(DEFAULT_FINANCE.mortgageType, 'interest_only');
  assert.equal(mortgagePayment(165_000, DEFAULT_FINANCE), 756.25);
  assert.equal(mortgagePayment(165_000, { ...DEFAULT_FINANCE, mortgageType: 'repayment' }), monthlyMortgage(165_000, 5.5, 25));
  assert.equal(MORTGAGE_NOTE(5.5), 'Interest-only mortgage at 5.5%: you pay the interest each month and the loan is repaid when you sell or refinance.');
  assert.ok(MORTGAGE_NOTE(5).startsWith('Interest-only mortgage at 5%:'));
  assert.ok(MORTGAGE_NOTE(5.291).startsWith('Interest-only mortgage at 5.29%:'));
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
  // Interest-only on the £165,000 loan: £756.25 a month, so £293.75 left of the £1,050 net operating.
  assert.equal(d.mortgageMonthly, 756);
  assert.equal(d.mortgageType, 'interest_only');
  const expectedCashflow = 12_600 / 12 - interestOnlyMortgage(165_000, 5.5);
  assert.ok(Math.abs(d.cashflowMonthly - expectedCashflow) <= 1, `cashflow ${d.cashflowMonthly} vs ${expectedCashflow}`);
  assert.ok(Math.abs(d.cashOnCashPct - ((expectedCashflow * 12) / d.cashRequired) * 100) < 0.1);
  // The repayment formula is still there behind the setting.
  const repayment = purchaseDeal(220_000, { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000, finance: { mortgageType: 'repayment' } });
  assert.equal(repayment.mortgageType, 'repayment');
  assert.ok(repayment.mortgageMonthly > 900 && repayment.mortgageMonthly < 1100);
  assert.ok(repayment.cashflowMonthly < d.cashflowMonthly);
  assert.equal(repayment.cashRequired, d.cashRequired, 'cash in does not depend on the payment');
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

// ── Batch 14: the most you can pay for your own monthly profit ──

test('most you can pay: £30,000 a year, £300 a month at 25% down, 5.5% interest-only', () => {
  const gross = 30_000;
  // The old figure: 10% gross yield, which at that price leaves only about £19 a month, well under the £300.
  assert.equal(maxPriceForYield(gross, 10), 300_000);
  const old = purchaseDeal(300_000, { grossRevenue: gross, adr: 0, bedrooms: 2 });
  assert.equal(old.netOperating, 12_600);
  assert.ok(old.cashflowMonthly > -50 && old.cashflowMonthly < 50, `the old figure barely breaks even (got ${old.cashflowMonthly})`);

  const r = maxPriceForProfit(12_600, 300, 25, 5.5, 25);
  assert.ok('price' in r);
  const price = (r as { price: number }).price;
  // payment £750 ÷ (5.5% ÷ 12) = £163,636 loan ÷ 0.75
  assert.ok(Math.abs(price - 218_182) < 5, `about £218,000 (got ${price})`);
  // Rounded down to £1,000 it still clears the £300, within £5 of it.
  const rounded = Math.floor(price / 1_000) * 1_000;
  assert.equal(rounded, 218_000);
  const at = 12_600 / 12 - interestOnlyMortgage(rounded * 0.75, 5.5);
  assert.ok(at >= 300 && at <= 305, `cash flow £${at.toFixed(2)} a month`);
  // The exact figure is the inverse of the mortgage: exactly £300 a month.
  assert.ok(Math.abs(12_600 / 12 - mortgagePayment(price * 0.75, DEFAULT_FINANCE) - 300) < 1e-6);
  // The repayment inverse is kept behind the setting: about £163,000 over 25 years.
  const rep = maxPriceForProfit(12_600, 300, 25, 5.5, 25, 'repayment') as { price: number };
  assert.ok(Math.abs(rep.price - 162_843) < 5, `about £163,000 (got ${rep.price})`);
  assert.ok(Math.abs(12_600 / 12 - monthlyMortgage(rep.price * 0.75, 5.5, 25) - 300) < 1e-6);
});

test('most you can pay: never 0 or negative; a cash buyer has no ceiling; no interest means no ceiling', () => {
  assert.deepEqual(maxPriceForProfit(12_600, 1_050, 25, 5.5, 25), { none: true }, 'the whole net is the profit: no price');
  assert.deepEqual(maxPriceForProfit(6_000, 800, 25, 5.5, 25), { none: true });
  assert.deepEqual(maxPriceForProfit(-2_000, 0, 25, 5.5, 25), { none: true });
  assert.deepEqual(maxPriceForProfit(12_600, 300, 100, 5.5, 25), { any: true });
  // Interest-only at 0%: nothing to pay whatever the loan, so no price is too high.
  assert.deepEqual(maxPriceForProfit(12_600, 300, 25, 0, 25), { any: true });
  // Repayment at 0% still has a figure: the capital over the term.
  const free = maxPriceForProfit(12_600, 300, 25, 0, 25, 'repayment') as { price: number };
  assert.equal(Math.round(free.price), Math.round((750 * 300) / 0.75));
  // A different profit or deposit gives a different figure.
  const at500 = (maxPriceForProfit(12_600, 500, 25, 5.5, 25) as { price: number }).price;
  const at40 = (maxPriceForProfit(12_600, 300, 40, 5.5, 25) as { price: number }).price;
  assert.ok(Math.abs(at500 - 160_000) < 1 && at500 < 218_182, `£500 a month: £160,000 (got ${at500})`);
  assert.ok(Math.abs(at40 - 272_727) < 5 && at40 > 218_182, `40% down: about £273,000 (got ${at40})`);
  // Never 0, negative or infinite over a grid of inputs; the inverse always holds.
  for (const net of [-5_000, 0, 3_000, 12_600, 60_000, 400_000]) {
    for (const min of [0, 300, 500, 2_000]) {
      for (const deposit of [0, 10, 25, 40, 75, 100]) {
        for (const rate of [0, 1, 5.5, 12]) {
          for (const type of ['interest_only', 'repayment'] as const) {
            const res = maxPriceForProfit(net, min, deposit, rate, 25, type);
            if (!('price' in res)) continue;
            assert.ok(Number.isFinite(res.price) && res.price > 0, `${net}/${min}/${deposit}/${rate}/${type}: ${res.price}`);
            const back = net / 12 - mortgagePayment(res.price * (1 - deposit / 100), { mortgageRatePct: rate, termYears: 25, mortgageType: type });
            assert.ok(Math.abs(back - min) < 1e-6, `${net}/${min}/${deposit}/${rate}/${type}: inverse gave ${back}`);
          }
        }
      }
    }
  }
});

test('a stored repayment deal reads at the current mortgage; current, rent-to-rent and lots are handled', () => {
  const current = purchaseDeal(220_000, { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000 });
  // An old row: the same deal as the repayment formula saved it, with no type.
  const oldRow = purchaseDeal(220_000, { grossRevenue: 30_000, adr: 150, bedrooms: 2, setupCost: 10_000, finance: { mortgageType: 'repayment' } });
  const old: PurchaseDeal = { ...oldRow };
  delete old.mortgageType;
  assert.equal(old.mortgageType, undefined);
  assert.ok(old.mortgageMonthly > 1000);
  const fresh = atCurrentMortgage(old);
  assert.equal(fresh.mortgageType, 'interest_only');
  assert.equal(fresh.mortgageMonthly, current.mortgageMonthly);
  assert.ok(Math.abs(fresh.cashflowMonthly - current.cashflowMonthly) <= 1);
  assert.ok(Math.abs(fresh.cashOnCashPct - current.cashOnCashPct) <= 0.1);
  // Everything else is as saved.
  assert.equal(fresh.cashRequired, old.cashRequired);
  assert.equal(fresh.netOperating, old.netOperating);
  assert.equal(fresh.stampDuty, old.stampDuty);
  assert.notEqual(fresh, old, 'a refreshed row is a new object');
  // Extras ride through (a report's basis and minimum profit).
  const withExtras = atCurrentMortgage({ ...old, basis: 'exact', minProfitPcm: 800 } as PurchaseDeal & { basis: string; minProfitPcm: number });
  assert.equal(withExtras.basis, 'exact');
  assert.equal(withExtras.minProfitPcm, 800);
  // A current deal is the same object; so is a rent-to-rent deal, and a row too old to carry the figures.
  assert.equal(atCurrentMortgage(current), current);
  const tooOld = { kind: 'purchase', askingPrice: 220_000, grossYieldPct: 13.6, targetYieldPct: 10 } as unknown as PurchaseDeal;
  assert.equal(atCurrentMortgage(tooOld), tooOld);
  const r2r: Deal = rentToRentDeal(1_200, { grossRevenue: 36_000, adr: 120, bedrooms: 2, setupCost: 8_000 });
  assert.equal(atCurrentMortgage(r2r), r2r);
  // A lot keeps its bridging cash and its cash-on-cash is worked on it.
  const lot = auctionDeal(200_000, 'traditional', { grossRevenue: 40_000, adr: 150, bedrooms: 3, setupCost: 10_000, finance: { mortgageType: 'repayment' } });
  const lotUntyped: PurchaseDeal = { ...lot };
  delete lotUntyped.mortgageType;
  const lotFresh = atCurrentMortgage(lotUntyped);
  const lotNow = auctionDeal(200_000, 'traditional', { grossRevenue: 40_000, adr: 150, bedrooms: 3, setupCost: 10_000 });
  assert.equal(lotFresh.cashRequired, lot.cashRequired);
  assert.deepEqual(lotFresh.auction, lot.auction);
  assert.equal(lotFresh.mortgageMonthly, lotNow.mortgageMonthly);
  assert.ok(Math.abs(lotFresh.cashOnCashPct - lotNow.cashOnCashPct) <= 0.1);
});
