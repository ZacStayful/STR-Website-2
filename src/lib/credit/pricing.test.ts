import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTable, unitKey } from './costs.ts';
import { priceFor, spendableBase, paidFrom, toGrantPence, lowBalanceState, formatGbp, DEFAULT_SPEND_RATES, round4 } from './pricing.ts';
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
  // Owner-approved ballpark: ≈ £8.60 typical, ≈ £11.50 worst case with PMI on,
  // after the PropertyData due diligence calls (eleven credits a report) were
  // added to every full report.
  assert.ok(e.typicalBasePence > 800 && e.typicalBasePence < 950, `typical ${e.typicalBasePence}`);
  assert.ok(e.maxBasePence > 1050 && e.maxBasePence < 1300, `max ${e.maxBasePence}`);
});

test('standard report has no PMI; enhanced adds it; PriceLabs on request', () => {
  const standard = estimateAction(table, 'report');
  const enhanced = estimateAction(table, 'report_enhanced');
  const withPl = estimateAction(table, 'report', { priceLabs: true });
  assert.ok(standard.typicalBasePence < 550, `standard ${standard.typicalBasePence}`);
  assert.ok(enhanced.typicalBasePence - standard.typicalBasePence > 300);
  assert.ok(withPl.typicalBasePence > standard.typicalBasePence);
});

test('formatGbp', () => {
  assert.equal(formatGbp(730), '£7.30');
  assert.equal(formatGbp(-48.33), '-£0.48');
  assert.equal(formatGbp(14000, { compact: true }), '£140');
});

// ─── Funnel markup override ───────────────────────────────────────────

test('an override replaces the row markup on both raw and base', () => {
  const t = seedTable();
  const at5 = priceFor(t, 'airbtics', 'report_all', 1);
  const at2 = priceFor(t, 'airbtics', 'report_all', 1, 2);
  assert.equal(at5.markup, 5);
  assert.equal(at2.markup, 2);
  assert.equal(at2.rawPence, at5.rawPence, 'our raw cost does not change with the markup');
  assert.equal(round4(at2.basePence), round4(at5.basePence / 5 * 2));
});

test('a nonsense override is ignored rather than making calls free', () => {
  const t = seedTable();
  const normal = priceFor(t, 'airbtics', 'report_all', 1).basePence;
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(priceFor(t, 'airbtics', 'report_all', 1, bad).basePence, normal, `override ${bad} should be ignored`);
  }
});

test('an unknown unit stays free whatever the override', () => {
  const t = seedTable();
  const p = priceFor(t, 'nope', 'nope', 1, 2);
  assert.equal(p.found, false);
  assert.equal(p.basePence, 0);
});

test('a funnel lead at x2 costs what the pricing was set from', () => {
  const t = seedTable();
  const std5 = estimateAction(t, 'report');
  const std2 = estimateAction(t, 'report', { markupOverride: 2 });
  const enh2 = estimateAction(t, 'report_enhanced', { markupOverride: 2 });

  // Our raw cost is the x5 base over 5, and must be untouched by the override.
  const rawTypical = round4(std5.typicalBasePence / 5);
  assert.equal(round4(std2.typicalBasePence), round4(rawTypical * 2));

  // The figures the funnel pricing was agreed from, in pounds. These are
  // the REPORT alone. A funnel lead also spends one Google autocomplete
  // session on the address, which is a separate action (~3p more at x2,
  // ~4p off a top-up) — that is why the per-lead totals below are a few
  // pence above these. The PropertyData due diligence calls (eleven
  // credits a report) were added to every report, funnel leads included,
  // with the owner's agreement: £2.08 → £2.91 a standard lead.
  const topup = DEFAULT_SPEND_RATES.topup;
  assert.equal((std2.typicalBasePence / 100).toFixed(2), '1.94', 'standard report base at x2');
  assert.equal((enh2.typicalBasePence / 100).toFixed(2), '3.44', 'enhanced report base at x2');
  assert.equal(((std2.typicalBasePence * topup) / 100).toFixed(2), '2.91', 'standard off a top-up');
  assert.equal(((enh2.typicalBasePence * topup) / 100).toFixed(2), '5.16', 'enhanced off a top-up');

  // And the per-lead totals actually quoted, report + one address lookup.
  const ac2 = estimateAction(t, 'autocomplete', { markupOverride: 2 });
  assert.equal((((std2.typicalBasePence + ac2.typicalBasePence) * topup) / 100).toFixed(2), '2.95');
  assert.equal((((enh2.typicalBasePence + ac2.typicalBasePence) * topup) / 100).toFixed(2), '5.20');

  // The worst case is what gets reserved, so it must stay above the typical.
  assert.ok(std2.maxBasePence > std2.typicalBasePence);
  assert.equal(round4(std2.maxBasePence), round4(std5.maxBasePence / 5 * 2));
});

test('the override never changes what the analyser itself charges', () => {
  const t = seedTable();
  // A member's own report must still price at x5 when no override is passed.
  assert.equal(estimateAction(t, 'report').typicalBasePence, estimateAction(t, 'report', {}).typicalBasePence);
  assert.notEqual(estimateAction(t, 'report').typicalBasePence, estimateAction(t, 'report', { markupOverride: 2 }).typicalBasePence);
});
