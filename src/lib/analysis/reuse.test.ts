import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShared, rebuildForMember, analysisComplete, reusable, sharedInputs, MEMBER_FIELDS } from './reuse.ts';
import { dealAnalysisInput } from './deal-input.ts';
import type { ListingSnapshot } from '../listing/types.ts';
import { dealFigures } from './deal-figures.ts';
import { DEMO_MANCHESTER } from '../demo-data.ts';
import type { AnalysisResult } from '../types.ts';
import type { CouncilTaxFigure } from '../listing/bills.ts';

const COUNCIL_TAX: CouncilTaxFigure = { band: 'C', annual: 1900, monthly: 158, match: 'address' } as unknown as CouncilTaxFigure;

/** A report as member A ran it: their 40% deposit at 6.25%, PropertyData's stamp duty at £200,000. */
function reportForMemberA(): AnalysisResult {
  const base: AnalysisResult = { ...DEMO_MANCHESTER, councilTax: COUNCIL_TAX, propertyValuation: { estimatedValue: 210_000, valuationRangeLow: 190_000, valuationRangeHigh: 230_000, source: 'propertydata' } };
  const { deal, cashflow, futureValue } = dealFigures({
    shortLet: base.shortLet,
    bedrooms: base.property.bedrooms,
    taxCountry: 'england',
    askingPrice: 200_000,
    rentPcm: null,
    estimatedValue: 210_000,
    councilTax: COUNCIL_TAX,
    stampDuty: { amount: 11_500, name: 'SDLT', effectiveRatePct: 5.8, country: 'england', source: 'propertydata' },
    growth: null,
    finance: { depositPct: 40, mortgageRatePct: 6.25, termYears: 20, targetYieldPct: 12, targetMarginPcm: 900 },
    liveRate: null,
  });
  return { ...base, deal, cashflow, futureValue, reportId: 'report-of-member-a', enhancedNotice: null, secondOpinion: { provider: 'pmi', updatedAt: '2026-09-20T00:00:00Z' } as AnalysisResult['secondOpinion'] };
}

test('nothing about the member who ran it is kept', () => {
  const shared = toShared(reportForMemberA());
  for (const k of MEMBER_FIELDS) assert.equal(k in shared.result, false, `${k} must not be kept`);
  const text = JSON.stringify(shared.result);
  // Their deposit, rate, term and targets only ever lived in their deal.
  for (const f of ['depositPct', 'mortgageRatePct', 'termYears', 'targetYieldPct', 'targetMarginPcm', 'report-of-member-a']) assert.equal(text.includes(f), false, `${f} leaked`);
});

test('what the providers said about the property is kept', () => {
  const shared = toShared(reportForMemberA());
  assert.equal(shared.result.shortLet.annualRevenue, DEMO_MANCHESTER.shortLet.annualRevenue);
  assert.ok(shared.result.secondOpinion);
  assert.deepEqual(shared.stampDuty, { amount: 11_500, name: 'SDLT', effectiveRatePct: 5.8, country: 'england', source: 'propertydata' });
  assert.equal(shared.stampDutyPrice, 200_000);
});

test('the buyer gets the figures at their own finance', () => {
  const report = rebuildForMember(toShared(reportForMemberA()), {
    finance: { depositPct: 10, mortgageRatePct: 4, termYears: 30, targetYieldPct: 8, targetMarginPcm: 300 },
    liveRate: null,
    askingPrice: 200_000,
    rentPcm: null,
    now: '2026-10-01T09:00:00Z',
  });
  assert.equal(report.deal?.kind, 'purchase');
  if (report.deal?.kind !== 'purchase') return;
  assert.equal(report.deal.depositPct, 10);
  assert.equal(report.deal.mortgageRatePct, 4);
  assert.equal(report.deal.termYears, 30);
  assert.equal(report.deal.mortgageRateSource, 'profile');
  assert.ok(report.cashflow && report.cashflow.length === 12);
  // The date the providers answered is kept; only updatedAt moves.
  assert.equal(report.createdAt, DEMO_MANCHESTER.createdAt);
  assert.equal(report.updatedAt, '2026-10-01T09:00:00Z');
  assert.equal(report.reportId, undefined);
});

test('a buyer with no saved finance gets the national average rate, not the first member’s', () => {
  const report = rebuildForMember(toShared(reportForMemberA()), { liveRate: { ratePct: 4.8, twoYearPct: 4.6, threeYearPct: 4.8, asOf: '2026-09-01' } as never, askingPrice: 200_000, rentPcm: null, now: '2026-10-01T09:00:00Z' });
  assert.equal(report.deal?.kind === 'purchase' && report.deal.mortgageRatePct, 4.8);
  assert.equal(report.deal?.kind === 'purchase' && report.deal.mortgageRateSource, 'live');
});

test('stamp duty: PropertyData’s figure at the same price, the local bands after a price change', () => {
  const same = rebuildForMember(toShared(reportForMemberA()), { liveRate: null, askingPrice: 200_000, rentPcm: null, now: '2026-10-01T09:00:00Z' });
  assert.equal(same.deal?.kind === 'purchase' && same.deal.stampDutySource, 'propertydata');
  const dropped = rebuildForMember(toShared(reportForMemberA()), { liveRate: null, askingPrice: 180_000, rentPcm: null, now: '2026-10-01T09:00:00Z' });
  assert.equal(dropped.deal?.kind === 'purchase' && dropped.deal.stampDutySource, 'local');
  assert.equal(dropped.deal?.kind === 'purchase' && dropped.deal.askingPrice, 180_000);
});

test('an analysis with no short-let figures is not a complete one', () => {
  assert.equal(analysisComplete(DEMO_MANCHESTER), true);
  assert.equal(analysisComplete({ shortLet: { ...DEMO_MANCHESTER.shortLet, annualRevenue: 0 } }), false);
  assert.equal(analysisComplete(null), false);
});

test('an analysis is reused for 30 days, then run again', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  assert.equal(reusable('2026-10-02T00:00:00Z', 30, now), true);
  assert.equal(reusable('2026-09-30T23:59:59Z', 30, now), false);
  assert.equal(reusable('not a date', 30, now), false);
});

test('the inputs kept with a saved analysis carry nothing of the member who ran it', () => {
  const snapshot: ListingSnapshot = { source: 'rightmove', id: '1', canonicalUrl: 'https://www.rightmove.co.uk/properties/1', fetchedAt: '2026-09-27T00:00:00Z', parserVersion: 3, kind: 'sale', title: 'Flat', displayAddress: 'Great Ancoats Street, Manchester', postcode: 'M4 5AE', bedrooms: 2, rawType: 'Apartment', price: { amount: 200_000, period: 'total' }, features: [], photos: [], locationConfidence: 'exact' };
  const r = dealAnalysisInput(snapshot, { canonicalUrl: snapshot.canonicalUrl, kind: 'sale', price: null, withPmi: true, checkedListingId: 'pipeline-row-of-member-a' });
  assert.ok(r.ok);
  if (!r.ok) return;
  const kept = sharedInputs({ ...r.input, email: 'a@example.test' });
  const text = JSON.stringify(kept);
  for (const f of ['pipeline-row-of-member-a', 'a@example.test', 'checkedListingId', 'email', 'fromDeal', 'enhancedRequested']) assert.equal(text.includes(f), false, `${f} leaked`);
  assert.equal(kept.property.postcode, 'M4 5AE');
});

test('a saved PMI opinion goes only to a buyer who paid for one', () => {
  const shared = toShared(reportForMemberA());
  const base = { liveRate: null, askingPrice: 200_000, rentPcm: null, now: '2026-10-01T09:00:00Z' };
  assert.equal(rebuildForMember(shared, { ...base, withSecondOpinion: false }).secondOpinion, null);
  assert.ok(rebuildForMember(shared, { ...base, withSecondOpinion: true }).secondOpinion);
});
