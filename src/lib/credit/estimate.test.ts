import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTable, unitKey } from './costs.ts';
import { estimateAction, PD_REPORT_UNITS } from './estimate.ts';

const table = seedTable();

test('a report reserves each PropertyData due diligence call once, and never the cron-bought ones', () => {
  for (const action of ['report', 'report_enhanced'] as const) {
    const e = estimateAction(table, action);
    const pd = e.lines.filter((l) => l.provider === 'propertydata');
    for (const unit of PD_REPORT_UNITS) {
      const lines = pd.filter((l) => l.unit === unit);
      assert.equal(lines.length, 1, `${action}: ${unit}`);
      assert.equal(lines[0].worstCaseOnly, false);
      assert.equal(lines[0].quantity, 1);
      assert.ok(lines[0].basePence > 0, `${unit} is priced`);
    }
    const units = new Set(pd.map((l) => l.unit));
    assert.equal(units.has('mortgage_rates'), false);
    assert.equal(units.has('postcode_key_stats'), false);
    // The three valuation units are still there.
    for (const k of ['propertydata:floor_areas', 'propertydata:valuation_rent', 'propertydata:valuation_sale']) {
      assert.ok(e.lines.some((l) => unitKey(l.provider, l.unit) === k), k);
    }
  }
});

test('the due diligence calls add their price at the caller\'s markup', () => {
  const x5 = estimateAction(table, 'report');
  const x2 = estimateAction(table, 'report', { markupOverride: 2 });
  const pdAt = (e: typeof x5) => e.lines.filter((l) => l.provider === 'propertydata' && (PD_REPORT_UNITS as readonly string[]).includes(l.unit)).reduce((s, l) => s + l.basePence, 0);
  assert.equal(pdAt(x5), PD_REPORT_UNITS.length * 2.5 * 5);
  assert.equal(pdAt(x2), PD_REPORT_UNITS.length * 2.5 * 2);
});

test('quick views, narration and geocoding are untouched', () => {
  assert.equal(estimateAction(table, 'quick_view').lines.some((l) => l.provider === 'propertydata'), false);
  assert.equal(estimateAction(table, 'geocode').lines.length, 1);
  assert.equal(estimateAction(table, 'narrate').lines.every((l) => l.provider === 'anthropic'), true);
});
