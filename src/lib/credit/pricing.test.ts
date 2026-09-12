import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTable, unitKey } from './costs.ts';
import { priceFor, spendableBase, paidFrom, toGrantPence, lowBalanceState, formatGbp, DEFAULT_SPEND_RATES } from './pricing.ts';
import { estimateAction } from './estimate.ts';

const table = seedTable();

test('priceFor multiplies raw cost by the row markup', () => {
  const p = priceFor(table, 'airbtics', 'report_all');
  assert.equal(p.found, true);
  assert.equal(p.rawPence, 39.5);
  assert.equal(p.basePence, 197.5);
});

test('priceFor scales by quantity and keeps fractional pence', () => {
  const p = priceFor(table, 'anthropic', 'output_token', 180);
  assert.ok(p.rawPence > 0.3 && p.rawPence < 0.4, `raw ${p.rawPence}`);
  assert.equal(p.basePence, Math.round(p.rawPence * 5 * 10_000) / 10_000);
});

test('unknown unit prices at zero and flags not found', () => {
  const p = priceFor(table, 'nope', 'thing');
  assert.equal(p.found, false);
  assert.equal(p.basePence, 0);
});

test('spendable base converts each bucket through its rate', () => {
  const s = spendableBase({ planPence: 500, welcomePence: 0, topupPence: 1000, adjustmentPence: 0 });
  assert.equal(s, 1166.6667);
});

test('top-up credit drains 1.5× faster', () => {
  assert.equal(toGrantPence(730, DEFAULT_SPEND_RATES.topup), 1095);
  assert.equal(toGrantPence(730, DEFAULT_SPEND_RATES.plan), 730);
});

test('paidFrom names the bucket(s) a charge would hit', () => {
  assert.equal(paidFrom({ planPence: 5000, welcomePence: 0, topupPence: 0, adjustmentPence: 0 }, 730), 'plan');
  assert.equal(paidFrom({ planPence: 0, welcomePence: 0, topupPence: 2500, adjustmentPence: 0 }, 730), 'topup');
  assert.equal(paidFrom({ planPence: 500, welcomePence: 0, topupPence: 2500, adjustmentPence: 0 }, 730), 'mixed');
  assert.equal(paidFrom({ planPence: 0, welcomePence: 0, topupPence: 0, adjustmentPence: 0 }, 730), 'none');
});

test('low-balance state: 80% of allowance → low, nothing spendable → out', () => {
  assert.equal(lowBalanceState({ cycleAllowancePence: 2000, cycleUsedPence: 500, spendableBasePence: 1500 }), 'ok');
  assert.equal(lowBalanceState({ cycleAllowancePence: 2000, cycleUsedPence: 1600, spendableBasePence: 400 }), 'low');
  assert.equal(lowBalanceState({ cycleAllowancePence: 2000, cycleUsedPence: 2000, spendableBasePence: 0 }), 'out');
  assert.equal(lowBalanceState({ cycleAllowancePence: 0, cycleUsedPence: 0, spendableBasePence: 0.2 }), 'out');
});

test('enhanced report estimate includes every unit and separates worst case', () => {
  const e = estimateAction(table, 'report_enhanced');
  const units = new Set(e.lines.map((l) => unitKey(l.provider, l.unit)));
  for (const k of ['google:geocode', 'propertydata:floor_areas', 'propertydata:valuation_rent', 'propertydata:valuation_sale', 'airbtics:report_all', 'airbtics:bounds', 'google:places_nearby', 'ticketmaster:event_search', 'pmi:str_estimate']) {
    assert.ok(units.has(k), `missing ${k}`);
  }
  assert.ok(e.maxBasePence > e.typicalBasePence);
  // Owner-approved ballpark: ≈ £7.30 typical, ≈ £9 worst case with PMI on.
  assert.ok(e.typicalBasePence > 650 && e.typicalBasePence < 800, `typical ${e.typicalBasePence}`);
  assert.ok(e.maxBasePence > 900 && e.maxBasePence < 1100, `max ${e.maxBasePence}`);
});

test('standard report has no PMI; enhanced adds it; PriceLabs on request', () => {
  const standard = estimateAction(table, 'report');
  const enhanced = estimateAction(table, 'report_enhanced');
  const withPl = estimateAction(table, 'report', { priceLabs: true });
  assert.ok(standard.typicalBasePence < 400, `standard ${standard.typicalBasePence}`);
  assert.ok(enhanced.typicalBasePence - standard.typicalBasePence > 300);
  assert.ok(withPl.typicalBasePence > standard.typicalBasePence);
});

test('formatGbp', () => {
  assert.equal(formatGbp(730), '£7.30');
  assert.equal(formatGbp(-48.33), '-£0.48');
  assert.equal(formatGbp(14000, { compact: true }), '£140');
});
