import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  screen,
  screenPurchase,
  screenRentToRent,
  fixedCostsFor,
  bandRank,
  lowerConfidence,
  describeScreening,
  BAND_LABELS,
  ABSOLUTE_QUALIFIED_SURPLUS,
  R2R_QUALIFIED_PROFIT,
  marketRentFor,
  grossRevenueFor,
  isSendable,
  screeningWorking,
  parseScreening,
  type Figure,
  type ScreenInput,
} from './screen.ts';

const est = (value: number): Figure => ({ value, source: 'estimated', confidence: 'medium' });
const firm = (value: number): Figure => ({ value, source: 'confirmed', confidence: 'high' });

const input = (over: Partial<ScreenInput> = {}): ScreenInput => ({
  bedrooms: 2,
  grossRevenue: est(45_000),
  marketRent: est(850),
  ...over,
});

// ── Fixed costs ──

test('fixed costs follow the table and clamp at both ends', () => {
  assert.equal(fixedCostsFor(1), 4_104);
  assert.equal(fixedCostsFor(2), 4_704);
  assert.equal(fixedCostsFor(3), 5_304);
  assert.equal(fixedCostsFor(4), 5_904);
  assert.equal(fixedCostsFor(5), 6_504);
  // A studio arrives as 0 from the OnTheMarket cards; anything above 5 is "5+".
  assert.equal(fixedCostsFor(0), 4_104);
  assert.equal(fixedCostsFor(7), 6_504);
});

// ── Purchase: the worked examples ──

test('purchase qualifies on the 40% uplift', () => {
  const s = screenPurchase(input({ grossRevenue: est(45_000), marketRent: est(850) }));
  assert.equal(s.kind, 'purchase');
  assert.equal(s.fixedCosts, 4_704);
  assert.equal(s.strNet, 19_800);
  assert.equal(s.ltlNet, 9_180);
  assert.equal(s.surplus, 5_916);
  assert.equal(s.upliftPct, 64.4);
  assert.equal(s.requiredGross, 39_900);
  assert.equal(s.gap, 5_100);
  assert.equal(s.band, 'qualified');
  assert.equal(s.byAbsolute, false);
});

test('purchase lands in medium between 10% and 40%, and reports the shortfall', () => {
  const s = screenPurchase(input({ grossRevenue: est(34_000), marketRent: est(850) }));
  assert.equal(s.strNet, 14_960);
  assert.equal(s.upliftPct, 11.7);
  assert.equal(s.requiredGross, 39_900);
  assert.equal(s.gap, -5_900);
  assert.equal(s.band, 'medium');
});

test('purchase under 10% is unqualified but still carries its gap', () => {
  const s = screenPurchase(input({ grossRevenue: est(30_000), marketRent: est(850) }));
  assert.equal(s.band, 'unqualified');
  assert.ok(s.upliftPct !== null && s.upliftPct < 10);
  assert.ok(s.gap !== null && s.gap < 0, 'a near-miss must be visible, not hidden');
});

// ── Rent-to-rent: the worked examples ──

test('rent-to-rent qualifies on £8,000 profit, with no agent fee on the rent', () => {
  const s = screenRentToRent(input({ bedrooms: 2, grossRevenue: est(60_000), marketRent: firm(900) }));
  assert.equal(s.kind, 'rent-to-rent');
  // Full rent, not 90% of it: the operator pays the landlord's asking price.
  assert.equal(s.annualRent, 10_800);
  assert.equal(s.strNet, 26_400);
  assert.equal(s.annualProfit, 10_896);
  assert.equal(s.requiredGross, 53_418);
  assert.equal(s.gap, 6_582);
  assert.equal(s.revenueMultiple, 5.56);
  assert.equal(s.band, 'qualified');
});

test('rent-to-rent is unqualified when the rent eats the margin', () => {
  const s = screenRentToRent(input({ bedrooms: 2, grossRevenue: est(42_000), marketRent: firm(1_100) }));
  assert.equal(s.annualRent, 13_200);
  assert.equal(s.annualProfit, 576);
  assert.equal(s.requiredGross, 58_873);
  assert.equal(s.gap, -16_873);
  assert.equal(s.revenueMultiple, 3.18);
  assert.equal(s.band, 'unqualified');
});

test('rent-to-rent medium band sits between £4,000 and £8,000', () => {
  const s = screenRentToRent(input({ bedrooms: 2, grossRevenue: est(52_000), marketRent: firm(900) }));
  assert.ok(s.annualProfit !== null && s.annualProfit >= 4_000 && s.annualProfit < 8_000);
  assert.equal(s.band, 'medium');
});

// ── The £20,000 absolute route ──

test('the £20,000 cash surplus qualifies a purchase whose uplift is under 40%', () => {
  const s = screenPurchase({ bedrooms: 4, grossRevenue: est(182_000), marketRent: est(5_000) });
  assert.equal(s.fixedCosts, 5_904);
  assert.equal(s.strNet, 80_080);
  assert.equal(s.ltlNet, 54_000);
  assert.equal(s.surplus, 20_176);
  assert.equal(s.upliftPct, 37.4, 'under the 40% bar');
  assert.equal(s.band, 'qualified', 'but over the £20,000 cash bar');
  assert.equal(s.byAbsolute, true);
  assert.match(s.reason, /cash bar/);
});

test('the absolute route only promotes — it never demotes or relabels a percentage pass', () => {
  const s = screenPurchase(input({ grossRevenue: est(45_000), marketRent: est(850) }));
  assert.equal(s.band, 'qualified');
  assert.ok(s.surplus !== null && s.surplus < ABSOLUTE_QUALIFIED_SURPLUS);
  assert.equal(s.byAbsolute, false, 'qualified on the percentage, so not credited to the cash route');
});

test('the absolute route can never bind on rent-to-rent, because £20k already clears £8k', () => {
  const s = screenRentToRent({ bedrooms: 1, grossRevenue: est(120_000), marketRent: firm(900) });
  assert.ok(s.annualProfit !== null && s.annualProfit > ABSOLUTE_QUALIFIED_SURPLUS);
  assert.ok(s.annualProfit >= R2R_QUALIFIED_PROFIT);
  assert.equal(s.band, 'qualified');
  assert.equal(s.byAbsolute, false, 'redundant by construction — kept only so both kinds run one rule');
});

// ── Insufficient data ──

test('an unknown bedroom count is not banded, and says the costs were assumed', () => {
  for (const kind of ['sale', 'rent'] as const) {
    const s = screen(kind, input({ bedrooms: null }));
    assert.equal(s.band, 'insufficient-data');
    assert.equal(s.bedroomsAssumed, true);
    assert.equal(s.fixedCosts, 5_904, 'the 4-bed figure, per the spec');
    assert.equal(s.strNet, null);
    assert.equal(s.confidence, null);
    assert.match(s.reason, /bedroom count/);
  }
});

test('a missing rent or revenue figure is not banded', () => {
  assert.equal(screenPurchase(input({ marketRent: null })).band, 'insufficient-data');
  assert.equal(screenPurchase(input({ grossRevenue: null })).band, 'insufficient-data');
  assert.equal(screenRentToRent(input({ marketRent: null })).band, 'insufficient-data');
  // A zero is as useless as a null and must not divide.
  assert.equal(screenPurchase(input({ marketRent: est(0) })).band, 'insufficient-data');
  assert.equal(screenRentToRent(input({ marketRent: est(0) })).band, 'insufficient-data');
  assert.equal(screenPurchase(input({ grossRevenue: est(0) })).band, 'insufficient-data');
});

test('a huge cash surplus never rescues insufficient data', () => {
  const s = screenPurchase({ bedrooms: null, grossRevenue: est(500_000), marketRent: est(5_000) });
  assert.equal(s.band, 'insufficient-data');
  assert.equal(s.byAbsolute, false);
});

// ── Dispatch, confidence and presentation ──

test('screen dispatches on listing kind', () => {
  assert.equal(screen('sale', input()).kind, 'purchase');
  assert.equal(screen('rent', input({ marketRent: firm(900) })).kind, 'rent-to-rent');
});

test('confidence is the weaker of the two inputs', () => {
  assert.equal(lowerConfidence('high', 'low'), 'low');
  assert.equal(lowerConfidence('medium', 'high'), 'medium');
  assert.equal(lowerConfidence('high', 'high'), 'high');
  const s = screenPurchase(input({ grossRevenue: { value: 45_000, source: 'estimated', confidence: 'low' }, marketRent: firm(850) }));
  assert.equal(s.confidence, 'low');
});

test('bands sort best first', () => {
  const sorted = (['unqualified', 'insufficient-data', 'qualified', 'medium'] as const).slice().sort((a, b) => bandRank(a) - bandRank(b));
  assert.deepEqual(sorted, ['qualified', 'medium', 'unqualified', 'insufficient-data']);
});

test('members see wording, not band keys', () => {
  assert.equal(BAND_LABELS.qualified, 'Short let recommended');
  assert.ok(!Object.values(BAND_LABELS).some((l) => /qualified/i.test(l) && l !== 'Short let recommended'));
  assert.match(describeScreening(screenPurchase(input())), /^Short let recommended · 64\.4% above a long let$/);
  assert.match(describeScreening(screenRentToRent(input({ grossRevenue: est(60_000), marketRent: firm(900) }))), /profit$/);
  assert.equal(describeScreening(screenPurchase(input({ bedrooms: null }))), 'Not enough data');
});

// ── Resolving the inputs (shared by the gate and the report) ──

test("a rental's advertised rent IS the market rent, and is confirmed", () => {
  const r = marketRentFor({ kind: "rent", bedrooms: 2, advertisedRentPcm: 1_250, storedRent: { monthlyRent: 900, samples: 40 } });
  assert.equal(r?.tier, "advertised");
  assert.equal(r?.figure.value, 1_250, "the asking rent wins — it is what the operator pays");
  assert.equal(r?.figure.source, "confirmed");
  assert.equal(r?.figure.confidence, "high");
});

test("a sale ignores any advertised figure and falls to our own reports", () => {
  const r = marketRentFor({ kind: "sale", bedrooms: 3, advertisedRentPcm: 9_999, storedRent: { monthlyRent: 1_050, samples: 12 } });
  assert.equal(r?.tier, "stored-reports");
  assert.equal(r?.figure.value, 1_050);
  assert.equal(r?.figure.source, "estimated");
  assert.equal(r?.figure.confidence, "medium");
});

test("a single stored report is a data point, not a trustworthy average", () => {
  const thin = marketRentFor({ kind: "sale", bedrooms: 3, advertisedRentPcm: null, storedRent: { monthlyRent: 1_050, samples: 1 } });
  assert.equal(thin?.figure.confidence, "low");
});

test("with nothing local, the national ladder answers at low confidence", () => {
  const r = marketRentFor({ kind: "sale", bedrooms: 2, advertisedRentPcm: null, storedRent: null });
  assert.equal(r?.tier, "national-ladder");
  assert.equal(r?.figure.confidence, "low");
  assert.equal(r?.figure.source, "estimated", "a national median is never confirmed");
});

test("no bedroom count means no rent can be resolved at all", () => {
  assert.equal(marketRentFor({ kind: "sale", bedrooms: null, advertisedRentPcm: null, storedRent: null }), null);
  // A rental with a real asking rent still resolves: the rent is on the listing.
  assert.ok(marketRentFor({ kind: "rent", bedrooms: null, advertisedRentPcm: 1_000, storedRent: null }));
});

test("revenue is always an estimate; only its precision varies", () => {
  assert.deepEqual(grossRevenueFor(30_000, true), { value: 30_000, source: "estimated", confidence: "medium" });
  assert.deepEqual(grossRevenueFor(30_000, false), { value: 30_000, source: "estimated", confidence: "low" });
  assert.equal(grossRevenueFor(0, true), null);
  assert.equal(grossRevenueFor(null, true), null);
});

// ── What gets sent, and what the member is shown ──

test("only qualified and medium are ever sendable", () => {
  assert.equal(isSendable(screenPurchase(input({ grossRevenue: est(45_000) }))), true);
  assert.equal(isSendable(screenPurchase(input({ grossRevenue: est(34_000) }))), true, "medium is the thin-day fallback");
  assert.equal(isSendable(screenPurchase(input({ grossRevenue: est(30_000) }))), false);
  assert.equal(isSendable(screenPurchase(input({ bedrooms: null }))), false, "never send what cannot be judged");
});

test("the working quotes every figure and marks the estimates", () => {
  const w = screeningWorking(screenPurchase(input({ grossRevenue: est(45_000), marketRent: est(850) })));
  const byLabel = Object.fromEntries(w.map((x) => [x.label, x.value]));
  assert.equal(byLabel["Short-let net"], "£19,800/yr");
  assert.equal(byLabel["Running costs"], "£4,704/yr");
  assert.equal(byLabel["Long-let net"], "£9,180/yr (est.)");
  assert.equal(byLabel["Uplift"], "64.4%");
  assert.equal(byLabel["To qualify"], "£39,900/yr gross — £5,100 above");
  assert.ok(!("Revenue multiple" in byLabel), "that is a rent-to-rent figure");
});

test("the working says how far short a near miss fell", () => {
  const w = screeningWorking(screenPurchase(input({ grossRevenue: est(34_000), marketRent: est(850) })));
  assert.match(Object.fromEntries(w.map((x) => [x.label, x.value]))["To qualify"], /£5,900 short$/);
});

test("a rent-to-rent working shows the rent and the multiple, not an uplift", () => {
  const w = screeningWorking(screenRentToRent(input({ grossRevenue: est(60_000), marketRent: firm(900) })));
  const byLabel = Object.fromEntries(w.map((x) => [x.label, x.value]));
  assert.equal(byLabel["Rent"], "£10,800/yr", "full rent, and not marked estimated");
  assert.equal(byLabel["Profit"], "£10,896/yr");
  assert.equal(byLabel["Revenue multiple"], "5.56× the rent");
  assert.ok(!("Uplift" in byLabel));
});

test("there is no working to show for something that could not be judged", () => {
  assert.deepEqual(screeningWorking(screenPurchase(input({ bedrooms: null }))), []);
});

// ── Reading a stored value back ──

test("a stored screening round-trips, and anything else degrades to null", () => {
  const original = screenRentToRent(input({ grossRevenue: est(60_000), marketRent: firm(900) }));
  const round = parseScreening(JSON.parse(JSON.stringify(original)));
  assert.equal(round?.band, "qualified");
  assert.equal(round?.kind, "rent-to-rent");
  // Rows written before the column existed, and anything malformed, must not throw.
  assert.equal(parseScreening(null), null);
  assert.equal(parseScreening(undefined), null);
  assert.equal(parseScreening({}), null);
  assert.equal(parseScreening({ band: "nonsense", kind: "purchase" }), null);
  assert.equal(parseScreening({ band: "qualified", kind: "spaceship" }), null);
  assert.equal(parseScreening("qualified"), null);
});
