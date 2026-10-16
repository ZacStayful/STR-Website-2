import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDeal } from './deal.ts';
import { growthRange } from './growth.ts';
import { rentRangeFor } from './rent.ts';
import { buildBtlCard } from './card.ts';
import type { Benchmark } from './benchmark.ts';
import { buildBtlReport, parseBtlReport, reportTitle, soldSummary } from './report.ts';
import { btlReportOffer } from '../analysis/offers.ts';
import type { DueDiligence } from '../types.ts';

function b44() {
  const rent = rentRangeFor({ bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: 52.54, lng: -1.86, districtRentPcm: 1_155.64, districtYieldPct: 6.2 }, [])!;
  const deal = btlDeal(160_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: 'D' })!;
  const growth = growthRange(160_000, 28.9, 3.9, 'B44', '2026-09-27');
  return buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 3, kind: 'house', country: 'england', outcode: 'B44', region: 'west_midlands', rent, deal, growth, rateDate: 'Sep 2026', band: '50k_100k', serviceChargeConfirmed: null, epc: 'D', shortLease: false });
}
const NATIONAL: Benchmark = { band: '50k_100k', step: 'national', radiusMiles: null, count: 157, steps: [], roiMedianPct: 0.8, roiP40Pct: 0.2, growthMedianPct: 1.83, growthP40Pct: 1.37, thin: false, none: false };
const DD = { postcode: 'B44 9AA', outcode: 'B44', floodRisk: { level: 'High', high: true }, conservationArea: { inside: false, name: null }, greenBelt: null, aonb: null, nationalPark: null, listedBuildings: { nearest: [], possiblyListed: false }, exitLiquidity: { sale: null, rent: null }, fetchedAt: '2026-10-16T10:00:00Z' } as DueDiligence;

test('the report: the summary in plain sentences from the figures, never an address or a full postcode', () => {
  const card = b44();
  const r = buildBtlReport({ createdAt: '2026-10-16T10:00:00Z', dealId: 'd1', title: reportTitle(3, 'house', 'B44'), outcode: 'B44', postcodeArea: 'B', price: 160_000, card, priority: 'income', band: '50k_100k', benchmark: NATIONAL, regionName: 'the West Midlands', saleValuation: { estimate: 165_000, low: 150_000, high: 180_000, confidence: 'medium' }, sold: soldSummary([{ price: 150_000 }, { price: 158_000 }, { price: 171_000 }] as never, 18), rentValuation: 1_300, dueDiligence: DD });
  assert.equal(r.title, '3-bed house in B44');
  assert.match(r.summary[0], /^At £160,000, this 3-bed house in B44 would let for about £[\d,]+–£[\d,]+ a month \(.*checked against a rent valuation of £1,300\)\.$/);
  assert.match(r.summary[1], /75% interest-only finance at 5\.1%/);
  assert.ok(r.summary.some((l) => /beats the typical deal for “money each month”/.test(l)));
  assert.ok(r.summary.some((l) => /the asking price is within that range/.test(l)));
  assert.ok(r.summary.some((l) => /3 similar homes sold nearby in the last 18 months, at a median of £158,000/.test(l)));
  assert.ok(r.summary.some((l) => /That is history, not a forecast\./.test(l)));
  assert.match(r.summary[r.summary.length - 1], /^Check before you offer: epc \(rated d\); flood risk \(high\)\.$/);
  assert.deepEqual(r.checks.map((c) => c.label), ['EPC', 'Flood risk', 'Conservation area', 'Listed buildings']);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('B44 9AA') && !/address|canonical|url/i.test(json));
  assert.deepEqual(parseBtlReport(JSON.parse(json)), r);
  assert.equal(parseBtlReport({ v: 9 }), null);
});

test('the welcome price: 50% on a revealed deal, inside the window, once, never under its worst-case cost', () => {
  const member = { offerDealIds: ['d1'], revealViewedAt: '2026-10-14T09:00:00Z', paysForSelf: true, hadDeepReport: false, usedWelcomeOn: [] };
  const settings = { revealAnalysisDiscountPct: 50, revealWelcomeDays: 7, deepFirstRunExtraPence: 100 };
  const now = new Date('2026-10-16T10:00:00Z');
  const at = (o: Partial<Parameters<typeof btlReportOffer>[0]>) => btlReportOffer({ dealId: 'd1', listPence: 200, member, usedWelcomeBtl: false, settings, floorPence: 37.5, now, ...o });
  assert.deepEqual(at({}), { pence: 100, offer: 'welcome_btl', listPence: 200 });
  assert.equal(at({ dealId: 'd2' }).offer, null, 'not a revealed deal');
  assert.equal(at({ usedWelcomeBtl: true }).offer, null, 'once per member');
  assert.equal(at({ now: new Date('2026-10-30T10:00:00Z') }).offer, null, 'outside the window');
  assert.equal(at({ member: { ...member, paysForSelf: false } }).offer, null, 'a team seat');
  assert.equal(at({ dealId: null }).offer, null, 'a listing, not a deal');
  assert.equal(at({ floorPence: 150 }).pence, 150, 'never under the worst-case raw cost');
  assert.equal(at({ floorPence: 250 }).offer, null, 'no cheaper than the list: no offer');
});
