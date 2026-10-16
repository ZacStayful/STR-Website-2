import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDeal } from './deal.ts';
import { growthRange } from './growth.ts';
import { rentRangeFor } from './rent.ts';
import { buildBtlCard, type BtlCard } from './card.ts';
import type { Benchmark } from './benchmark.ts';
import { benchmarkWords, btlSheet, rentTestWords, verdictWords } from './sheet.ts';
import { BTL_DISCLAIMER } from './nation.ts';

function b44(): BtlCard {
  const rent = rentRangeFor({ bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: 52.54, lng: -1.86, districtRentPcm: 1_155.64, districtYieldPct: 6.2 }, [])!;
  const deal = btlDeal(160_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: null })!;
  const growth = growthRange(160_000, 28.9, 3.9, 'B44', '2026-09-27');
  return buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 3, kind: 'house', country: 'england', outcode: 'B44', region: 'west_midlands', rent, deal, growth, rateDate: 'Sep 2026', band: '50k_100k', serviceChargeConfirmed: null, epc: null, shortLease: false });
}
const NATIONAL: Benchmark = { band: '50k_100k', step: 'national', radiusMiles: null, count: 157, steps: [], roiMedianPct: 0.8, roiP40Pct: 0.2, growthMedianPct: 1.83, growthP40Pct: 1.37, thin: false, none: false };

test('every figure the brief calls a range is one; the costs are line by line; the notes and the disclaimer close it', () => {
  const s = btlSheet(b44(), { priority: 'income', benchmark: NATIONAL });
  const row = (label: string) => s.rows.find((r) => r.label === label)!;
  for (const label of ['Rent a month', 'Gross yield', 'Net yield', 'Running costs a month', 'Cashflow a month', 'Cash in', 'ROI', 'Value in 5 years', 'Growth a year']) assert.match(row(label).value, /–| to /, label);
  assert.match(row('Cash in').sub!, /deposit, £[\d,]+ SDLT, £2,500 buying costs; the top end adds £5,000 for an energy upgrade/);
  assert.match(row('Growth a year').sub!, /in the last year/);
  assert.deepEqual(
    s.costs.map((c) => c.label),
    ['Empty month (1 a year)', 'Letting agent (12% incl. VAT)', 'Repairs (8%)', 'Insurance', 'Safety certificates', 'Total a month, at the middle rent'],
    'a house has no service charge or ground rent lines',
  );
  assert.match(s.epc!, /EPC C by 2030/);
  assert.match(s.rules, /Renters’ Rights Act/);
  assert.equal(s.disclaimer, BTL_DISCLAIMER);
  assert.match(s.rate, /2-year fixed rate \(Sep 2026\): 5\.1%/);
  assert.match(s.benchmark!, /^Compared with 157 buy-to-let deals across the UK with £50k–£100k cash in: typical ROI 0\.8%, growth 1\.8% a year\.$/);
  assert.match(s.verdict, /^Beats the typical deal for “money each month”: ROI \d+\.\d% against a typical 0\.8%\.$/);
});

test('the rent test: a pass with its margin, "tight" when the low rent would fail, and a fail with the deposit that would pass', () => {
  const card = b44();
  const pass = rentTestWords(card);
  assert.equal(pass.pass, true);
  assert.match(pass.text, /^Passes the lender’s rent test: £1,362 rent against £891 needed \(125% of the interest at 7\.1%\)\.$/);
  assert.equal(pass.tight, null);
  const tight = rentTestWords({ ...card, rent: { ...card.rent, low: 850 } });
  assert.match(tight.tight!, /^Tight: at the low end/);
  // CA2 Carlisle (the plan's worked example): fails, passes with a 30% deposit.
  const fail = rentTestWords({ ...card, rent: { ...card.rent, low: 846, mid: 940 }, rentTest: { pass: false, rent: 940, stressRatePct: 7.13, requiredRent: 1_003, maxLoan: 126_000, depositPctToPass: 30, depositToPass: 54_000 } });
  assert.equal(fail.text, 'Fails the lender’s rent test: £940 rent, £1,003 needed (125% of the interest at 7.1%). Passes with a 30% deposit (£54,000).');
});

test('the benchmark in words: thin, too few, and how the deal does for each priority', () => {
  assert.equal(benchmarkWords(null, null), null);
  assert.match(benchmarkWords({ ...NATIONAL, band: '25k_50k', count: 26, thin: true }, null)!, /That is fewer than we like to compare with/);
  assert.match(benchmarkWords({ ...NATIONAL, count: 4, none: true }, null)!, /^Too few buy-to-let deals with £50k–£100k cash in to compare \(4 across the UK\)/);
  assert.match(benchmarkWords({ ...NATIONAL, step: 'region', count: 61 }, 'the North West')!, /across the North West/);
  const card = b44();
  assert.match(verdictWords('growth', card, { ...NATIONAL, growthMedianPct: 4.5 }), /^Below the typical deal for “value going up”/);
  assert.match(verdictWords('both', card, NATIONAL), /^Beats the typical deal for “a bit of both”/);
  assert.match(verdictWords('income', card, null), /passes the lender’s rent test/);
});

test('a flat: its service charge and ground rent are their own lines, marked when not confirmed', () => {
  const rent = rentRangeFor({ bedrooms: 2, kind: 'flat', postcodeArea: 'LS', lat: 53.8, lng: -1.55, districtRentPcm: 950, districtYieldPct: 6.5 }, [])!;
  const deal = btlDeal(110_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: { serviceCharge: { low: 900, mid: 1_500, high: 2_100 }, groundRent: { low: 90, mid: 150, high: 210 }, confirmed: false }, epc: 'C' })!;
  const card = buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 2, kind: 'flat', country: 'england', outcode: 'LS1', region: 'north_east', rent, deal, growth: null, rateDate: null, band: '25k_50k', serviceChargeConfirmed: false, epc: 'C', shortLease: false });
  const s = btlSheet(card, { priority: 'both', benchmark: null });
  assert.ok(s.costs.some((c) => c.label === 'Service charge (not confirmed: an estimate)'));
  assert.ok(s.costs.some((c) => c.label === 'Ground rent'));
  assert.equal(s.epc, null, 'EPC C: nothing to say');
  assert.ok(!s.rows.some((r) => r.label === 'Value in 5 years'), 'no growth figure, no growth rows');
});
