import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btlDeal } from './deal.ts';
import { growthRange } from './growth.ts';
import { rentRangeFor } from './rent.ts';
import { buildBtlCard, type BtlCard } from './card.ts';
import type { Benchmark } from './benchmark.ts';
import { DEFAULT_BTL_SETTINGS } from './config.ts';
import { judgeStandout, memberSkip, type StandoutInput } from '../standout/rules.ts';
import { DEFAULT_STANDOUT } from '../standout/settings.ts';
import { whatOf } from '../standout/copy.ts';
import type { Judgement } from '../tailoring/criteria.ts';

function b44(): BtlCard {
  const rent = rentRangeFor({ bedrooms: 3, kind: 'house', postcodeArea: 'B', lat: 52.54, lng: -1.86, districtRentPcm: 1_155.64, districtYieldPct: 6.2 }, [])!;
  const deal = btlDeal(160_000, rent, { ratePct: 5.13, country: 'england', buyingCosts: 2_500, flat: null, epc: null })!;
  const growth = growthRange(160_000, 28.9, 3.9, 'B44', '2026-09-27');
  return buildBtlCard({ computedAt: '2026-10-16T04:50:00Z', bedrooms: 3, kind: 'house', country: 'england', outcode: 'B44', region: 'west_midlands', rent, deal, growth, rateDate: 'Sep 2026', band: '50k_100k', serviceChargeConfirmed: null, epc: null, shortLease: false });
}
// A tighter rent range than the district alone gives: 7% at the low end, over the 6% income floor.
const STRONG: BtlCard = { ...b44(), roiPct: { low: 7, mid: 10.2, high: 14.9 } };
const NATIONAL: Benchmark = { band: '50k_100k', step: 'national', radiusMiles: null, count: 157, steps: [], roiMedianPct: 0.8, roiP40Pct: 0.2, growthMedianPct: 1.83, growthP40Pct: 1.37, thin: false, none: false };
const judgement = (mustFails: string[] = []) => ({ checks: [], mustFails, mustUnknown: [], niceMissed: 0, met: 0, unknown: 0, checked: 0 }) as unknown as Judgement;

const input = (over: Partial<StandoutInput> = {}, btl: Partial<NonNullable<StandoutInput['btl']>> = {}): StandoutInput => ({
  judgement: judgement(),
  facts: { kind: 'sale', dealType: 'btl', dealTypes: ['btl'], project: null },
  figures: { range: null },
  wants: { minProfit: null, minProfitR2r: null },
  chosenTypes: ['btl'],
  revealPct: null,
  settings: DEFAULT_STANDOUT,
  btl: { card: STRONG, priority: 'income', cashBand: '50k_100k', benchmark: NATIONAL, settings: DEFAULT_BTL_SETTINGS.standout, bands: DEFAULT_BTL_SETTINGS.bands, ...btl },
  ...over,
});

test('a buy-to-let standout: passes their priority, in their band, and the low end beats 125% of the median (and 6% for income)', () => {
  const r = judgeStandout(input());
  assert.equal(r.outcome, 'standout');
  assert.equal(r.dealType, 'btl');
  assert.equal(r.profitBasis, 'btl_cashflow');
  assert.equal(r.profitLow, STRONG.cashflowMonthly.low, 'the bar it sets is its own low-end cashflow');
  assert.equal(judgeStandout(input({}, { card: b44() })).reason, 'btl_not_standout', 'the district-only range: 5% at the low end, under the 6% income floor');
  assert.equal(r.minProfit, null, 'no minimum-profit answer needed');
});

test('not a buy-to-let standout: below the benchmark, over the band, outside their areas, no figures, or good but not 125%', () => {
  assert.equal(judgeStandout(input({}, { benchmark: { ...NATIONAL, roiMedianPct: 30 } })).reason, 'btl_below_benchmark');
  assert.equal(judgeStandout(input({}, { cashBand: '25k_50k' })).reason, 'btl_over_budget');
  assert.equal(judgeStandout(input({ judgement: judgement(['location']) })).reason, 'must_have_missed');
  assert.equal(judgeStandout(input({}, { card: null })).reason, 'btl_no_figures');
  assert.equal(judgeStandout(input({ btl: null })).inPool, false, 'without its own rule, never judged on short-let figures');
  assert.equal(judgeStandout(input({}, { benchmark: { ...NATIONAL, roiMedianPct: 9 } })).reason, 'btl_not_standout', 'passes the median, but its low end is under 125% of it');
  assert.equal(judgeStandout(input({}, { benchmark: { ...NATIONAL, roiMedianPct: 0 } })).reason, 'btl_not_standout', 'never on a median of 0% or less');
  assert.equal(judgeStandout(input({ chosenTypes: ['buy_str'] })).reason, 'type_not_chosen');
});

test('a Buy to let profile needs no minimum-profit answer to be judged; the call names the deal as one', () => {
  const primary = { forClient: false, pausedAt: null };
  assert.equal(memberSkip({ isTeamMember: false, primary, chosenTypes: ['btl'], wants: { minProfit: null, minProfitR2r: null } }), null);
  assert.equal(memberSkip({ isTeamMember: false, primary, chosenTypes: ['buy_str'], wants: { minProfit: null, minProfitR2r: null } }), 'no_min_profit');
  assert.equal(whatOf({ bedrooms: 3, propertyKind: 'house', dealType: 'btl' }), '3-bed house to let to long-term tenants');
});
