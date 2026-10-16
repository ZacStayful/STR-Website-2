import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALL_PLACEHOLDERS, CONDITIONS, PLACEHOLDERS, countWords, dayWords, hourWords, moneyList } from './placeholders.ts';
import { SAMPLE_MEMBER } from './render.ts';
import { schemaSnapshot } from './test-fixtures.ts';
import { PRODUCT_FACTS } from './config.ts';
import { sectionsFor } from '../pdf/sections.ts';

// Review R3 (R3-21): the report's sections depend on the deal, so the knowledge base quotes the most a report has, never a count.
test('report_sections is the most sections a report has, as the PDF counts them', () => {
  assert.equal(PRODUCT_FACTS.reportSectionsMax, sectionsFor({ setup: true, deal: true, diligence: true, project: true, secondOpinion: true, plan: true }).length);
  assert.equal(PLACEHOLDERS.report_sections.resolve(schemaSnapshot(), null), String(PRODUCT_FACTS.reportSectionsMax));
  assert.match(PLACEHOLDERS.report_sections.label, /up to/);
});

test('every global placeholder resolves against what schema.sql seeds', () => {
  const g = schemaSnapshot();
  for (const [name, def] of Object.entries(PLACEHOLDERS)) {
    if (def.scope !== 'global') continue;
    assert.notEqual(def.resolve(g, null), null, `{${name}} does not resolve from the schema seeds (${def.reads})`);
  }
});

test('the seeded figures read as members see them', () => {
  const g = schemaSnapshot();
  const r = (n: string) => PLACEHOLDERS[n].resolve(g, null);
  assert.equal(r('welcome_credit'), '£20');
  assert.equal(r('lowest_plan_cost'), '£19');
  assert.equal(r('open_cost_min'), '25p');
  assert.equal(r('open_cost_max'), '£1');
  assert.equal(r('topup_amounts'), '£10, £25 or £50');
  assert.equal(r('topup_rate'), '1.3×');
  assert.equal(r('call_minute_cost'), '65p');
  assert.equal(r('call_hours_start'), '9am');
  assert.equal(r('call_hours_end'), '7pm');
  assert.equal(r('call_days'), 'weekdays');
  assert.equal(r('management_fee'), '15% + VAT');
  // Review R3: the briefing ceiling is a setting; the seed is 3p and the switch is seeded off.
  assert.equal(r('briefing_max_cost'), '3p');
  assert.equal(PLACEHOLDERS.briefing_max_cost.resolve(schemaSnapshot({ settings: { briefing_ceiling_pence: 2.5 } }), null), '2.5p');
  assert.equal(PLACEHOLDERS.briefing_max_cost.resolve(schemaSnapshot({ settings: { briefing_ceiling_pence: 0 } }), null), null);
  assert.equal(CONDITIONS.briefings_on.resolve(g, null), false);
  assert.equal(CONDITIONS.briefings_on.resolve(schemaSnapshot({ settings: { briefings_enabled: true } }), null), true);
  assert.equal(CONDITIONS.briefings_on.resolve(schemaSnapshot({ drop: ['briefings_enabled'] }), null), null);
});

test('a removed or malformed setting resolves to null, never a default', () => {
  assert.equal(PLACEHOLDERS.full_analysis_cost.resolve(schemaSnapshot({ drop: ['full_analysis_pence'] }), null), null);
  assert.equal(PLACEHOLDERS.full_analysis_cost.resolve(schemaSnapshot({ settings: { full_analysis_pence: 0 } }), null), null);
  assert.equal(PLACEHOLDERS.open_cost_min.resolve(schemaSnapshot({ settings: { deal_open_ladder: [{ upTo: 100, pence: 25 }] } }), null), null);
  assert.equal(PLACEHOLDERS.topup_rate.resolve(schemaSnapshot({ settings: { spend_rates: { plan: 1 } } }), null), null);
  assert.equal(PLACEHOLDERS.call_hours_start.resolve(schemaSnapshot({ settings: { si_outbound_start_hour: 20 } }), null), null);
  const noUnit = { ...schemaSnapshot(), units: new Map() };
  assert.equal(PLACEHOLDERS.call_minute_cost.resolve(noUnit, null), null);
  const noPlans = { ...schemaSnapshot(), plans: [] };
  assert.equal(PLACEHOLDERS.lowest_plan_cost.resolve(noPlans, null), null);
});

test("member placeholders need a member and never reach a call", () => {
  const g = schemaSnapshot();
  assert.equal(PLACEHOLDERS.balance.resolve(g, null), null);
  assert.equal(PLACEHOLDERS.balance.resolve(g, SAMPLE_MEMBER), '£12.40');
  assert.equal(PLACEHOLDERS.credit_balance_band.resolve(g, SAMPLE_MEMBER), 'between £5 and £20');
  assert.equal(PLACEHOLDERS.checked_count.resolve(g, { ...SAMPLE_MEMBER, checked: null }), null);
  for (const n of CALL_PLACEHOLDERS) assert.equal(PLACEHOLDERS[n].scope, 'global', n);
  assert.ok(!CALL_PLACEHOLDERS.includes('balance'));
  assert.ok(!CALL_PLACEHOLDERS.includes('credit_balance_band'));
});

test("no call placeholder's name says balance, address or price (the agent's variable rule)", () => {
  for (const n of CALL_PLACEHOLDERS) assert.ok(!/balance|address|price/.test(n), n);
});

test('conditions', () => {
  const g = schemaSnapshot();
  assert.equal(CONDITIONS.calls_live.resolve(g, null), false);
  assert.equal(CONDITIONS.calls_live.resolve(schemaSnapshot({ callsLive: true }), null), true);
  assert.equal(CONDITIONS.welcome_offer.resolve(g, null), null);
  assert.equal(CONDITIONS.free_delay_applies.resolve(g, SAMPLE_MEMBER), true);
  assert.equal(CONDITIONS.free_delay_applies.resolve(schemaSnapshot({ settings: { free_deal_delay_hours: 0 } }), SAMPLE_MEMBER), false);
});

test('formatters', () => {
  assert.equal(countWords(5), 'five');
  assert.equal(countWords(1284), '1,284');
  assert.equal(moneyList([1000]), '£10');
  assert.equal(hourWords(12), 'noon');
  assert.equal(dayWords([1, 2, 3, 4, 5, 6]), 'Monday to Saturday');
  assert.equal(dayWords([1, 3]), 'Mondays and Wednesdays');
});

test('Batch 28: the buy-to-let figures read from their settings, and a malformed row reads as nothing', () => {
  const g = schemaSnapshot();
  const r = (n: string) => PLACEHOLDERS[n].resolve(g, null);
  assert.equal(r('btl_report_cost'), '£2');
  assert.equal(r('btl_ltv'), '75%');
  assert.equal(r('btl_rent_test'), 'at least 125% of the monthly mortgage interest worked out at the higher of the live rate plus 2% or 5.5%');
  assert.equal(r('btl_running_costs'), 'a letting agent at 12% of the rent (VAT included), repairs at 8%, one empty month a year, insurance at £25 a month and £300 a year of safety certificates');
  assert.equal(r('btl_epc_allowance'), "£5,000 for an EPC of D, £10,000 for E to G, and £5,000 while the EPC isn't checked");
  assert.equal(r('btl_cash_bands'), 'under £25k, £25k–£50k, £50k–£100k or £100k or more');
  assert.equal(r('btl_standout_margin'), '125%');
  assert.equal(PLACEHOLDERS.btl_ltv.resolve(schemaSnapshot({ settings: { btl_finance: { ltvPct: 'lots' } } }), null), null);
  assert.equal(PLACEHOLDERS.btl_cash_bands.resolve(schemaSnapshot({ settings: { btl_bands: [50000, 25000] } }), null), null);
  assert.equal(PLACEHOLDERS.btl_report_cost.resolve(schemaSnapshot({ drop: ['btl_report_pence'] }), null), null);
});
