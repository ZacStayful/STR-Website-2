import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLeadRules, evaluateLead, measureLead, rulesAreEmpty,
  DEFAULT_LEAD_RULES, type LeadRules,
} from './rules.ts';
import type { AnalysisResult, ShortLetComparable } from '../types.ts';

function comp(reviewCount: number, rating = 4.7): ShortLetComparable {
  return {
    title: 'c', url: '#', bedrooms: 2, accommodates: 4, averageDailyRate: 120,
    occupancyRate: 0.6, annualRevenue: 26000, rating, reviewCount,
    listingAge: 2, daysAvailable: 300, amenityCount: 12,
  };
}

/** A report with just the fields the rules read. */
function report(over: {
  bedrooms?: number; postcode?: string; annualRevenue?: number; comps?: ShortLetComparable[];
} = {}): AnalysisResult {
  return {
    property: { address: '12 Oak St', postcode: over.postcode ?? 'M1 4BT', bedrooms: over.bedrooms ?? 3, guests: 6 },
    shortLet: {
      annualRevenue: over.annualRevenue ?? 75000,
      comparables: over.comps ?? [comp(40), comp(50), comp(60)],
    },
  } as unknown as AnalysisResult;
}

const rules = (over: Partial<LeadRules> = {}): LeadRules => ({ ...DEFAULT_LEAD_RULES, ...over });

// ─── Parsing ──────────────────────────────────────────────────────────

test('an unusable stored value becomes no filter, letting leads through', () => {
  for (const bad of [null, undefined, 'nonsense', 42, {}, { version: 2, bedroomsMin: 3 }]) {
    const r = parseLeadRules(bad);
    assert.equal(rulesAreEmpty(r), true, `expected empty rules for ${JSON.stringify(bad)}`);
    assert.equal(evaluateLead(report(), r).qualified, true);
  }
});

test('a backwards bedroom range is swapped, not treated as reject-everything', () => {
  const r = parseLeadRules({ version: 1, bedroomsMin: 5, bedroomsMax: 2 });
  assert.equal(r.bedroomsMin, 2);
  assert.equal(r.bedroomsMax, 5);
  assert.equal(evaluateLead(report({ bedrooms: 3 }), r).qualified, true);
});

test('money strings with pounds and commas parse', () => {
  assert.equal(parseLeadRules({ version: 1, grossRevenueMin: '£60,000' }).grossRevenueMin, 60000);
  assert.equal(parseLeadRules({ version: 1, grossRevenueMin: 'lots' }).grossRevenueMin, null);
});

test('out-of-range values are dropped rather than clamped', () => {
  assert.equal(parseLeadRules({ version: 1, bedroomsMin: 99 }).bedroomsMin, null);
  assert.equal(parseLeadRules({ version: 1, maxCompetitionIntensity: 150 }).maxCompetitionIntensity, null);
  assert.equal(parseLeadRules({ version: 1, grossRevenueMin: -1 }).grossRevenueMin, null);
});

test('postcode areas are upper-cased, de-duplicated and validated', () => {
  const r = parseLeadRules({ version: 1, postcodeAreas: ['m', 'M', 'ls', '12', 'TOOLONG', ''] });
  assert.deepEqual(r.postcodeAreas, ['M', 'LS']);
  assert.equal(parseLeadRules({ version: 1, postcodeAreas: [] }).postcodeAreas, null);
  assert.equal(parseLeadRules({ version: 1, postcodeAreas: 'M' }).postcodeAreas, null);
});

// ─── Measuring ────────────────────────────────────────────────────────

test('zero revenue reads as unavailable, not as a free property', () => {
  assert.equal(measureLead(report({ annualRevenue: 0 })).grossRevenue, null);
});

test('average reviews ignore unreviewed listings', () => {
  // 0 would drag a crowded market's average down and make it look open.
  assert.equal(measureLead(report({ comps: [comp(0), comp(100), comp(200)] })).avgReviewCount, 150);
});

test('no comparables leaves saturation and intensity unmeasured', () => {
  const m = measureLead(report({ comps: [] }));
  assert.equal(m.avgReviewCount, null);
  assert.equal(m.competitionIntensity, null);
});

// ─── The worked example: 2-5 bed, £60k+, under 100 reviews ────────────

const worked = rules({ bedroomsMin: 2, bedroomsMax: 5, grossRevenueMin: 60000, maxAvgReviewCount: 100 });

test('a 3-bed at £75k in a 50-review market qualifies', () => {
  const v = evaluateLead(report(), worked);
  assert.equal(v.qualified, true);
  assert.equal(v.unknownChecks, 0);
  assert.equal(v.summary, 'Meets every rule.');
  assert.deepEqual(v.checks.map((c) => c.status), ['pass', 'pass', 'pass']);
});

test('a 1-bed fails on bedrooms and says so in pounds and bedrooms', () => {
  const v = evaluateLead(report({ bedrooms: 1 }), worked);
  assert.equal(v.qualified, false);
  const bed = v.checks.find((c) => c.rule === 'bedrooms');
  assert.equal(bed?.status, 'fail');
  assert.equal(bed?.actual, 1);
  assert.equal(bed?.threshold, '2–5 bedrooms');
  assert.match(bed?.reason ?? '', /below the 2 minimum/);
});

test('a 6-bed fails the upper bound too', () => {
  const v = evaluateLead(report({ bedrooms: 6 }), worked);
  assert.equal(v.qualified, false);
  assert.match(v.summary, /above the 5 maximum/);
});

test('£40k against a £60k minimum fails, with both figures formatted', () => {
  const v = evaluateLead(report({ annualRevenue: 40000 }), worked);
  assert.equal(v.qualified, false);
  assert.match(v.summary, /£40,000 projected is below the £60,000 minimum/);
});

test('a saturated market fails on review count', () => {
  const v = evaluateLead(report({ comps: [comp(150), comp(250)] }), worked);
  assert.equal(v.qualified, false);
  const rev = v.checks.find((c) => c.rule === 'avgReviewCount');
  assert.equal(rev?.actual, 200);
  assert.match(rev?.reason ?? '', /above the 100 ceiling/);
});

test('exactly at a threshold qualifies — the bounds are inclusive', () => {
  assert.equal(evaluateLead(report({ bedrooms: 2 }), worked).qualified, true);
  assert.equal(evaluateLead(report({ bedrooms: 5 }), worked).qualified, true);
  assert.equal(evaluateLead(report({ annualRevenue: 60000 }), worked).qualified, true);
  assert.equal(evaluateLead(report({ comps: [comp(100)] }), worked).qualified, true);
});

test('every failing rule is reported, not just the first', () => {
  const v = evaluateLead(report({ bedrooms: 1, annualRevenue: 10000, comps: [comp(400)] }), worked);
  assert.equal(v.qualified, false);
  assert.equal(v.checks.filter((c) => c.status === 'fail').length, 3);
});

// ─── Unmeasurable rules ───────────────────────────────────────────────

test('a rule that cannot be measured does not lose the lead', () => {
  const v = evaluateLead(report({ comps: [] }), worked);
  assert.equal(v.qualified, true, 'missing comparables must not silently discard a lead');
  assert.equal(v.unknownChecks, 1);
  assert.match(v.summary, /1 rule could not be checked/);
  assert.equal(v.checks.find((c) => c.rule === 'avgReviewCount')?.status, 'unknown');
});

test('the summary pluralises unchecked rules', () => {
  const v = evaluateLead(report({ annualRevenue: 0, comps: [] }), worked);
  assert.equal(v.qualified, true);
  assert.match(v.summary, /2 rules could not be checked/);
});

// ─── Location ─────────────────────────────────────────────────────────

test('an allow list keeps only the areas the customer covers', () => {
  const r = rules({ postcodeAreas: ['M', 'LS'] });
  assert.equal(evaluateLead(report({ postcode: 'M1 4BT' }), r).qualified, true);
  const out = evaluateLead(report({ postcode: 'BS1 5TR' }), r);
  assert.equal(out.qualified, false);
  assert.match(out.summary, /BS is outside the areas you cover/);
});

test('a block list beats an allow list when an area is on both', () => {
  const r = rules({ postcodeAreas: ['M'], excludePostcodeAreas: ['M'] });
  const v = evaluateLead(report({ postcode: 'M1 4BT' }), r);
  assert.equal(v.qualified, false);
  assert.match(v.summary, /excluded list/);
});

test('an unreadable postcode is unknown, not a rejection', () => {
  const v = evaluateLead(report({ postcode: '12345' }), rules({ postcodeAreas: ['M'] }));
  assert.equal(v.qualified, true);
  assert.equal(v.unknownChecks, 1);
});

// ─── No rules ─────────────────────────────────────────────────────────

test('with no filter set, nothing is checked and everything qualifies', () => {
  const v = evaluateLead(report({ bedrooms: 1, annualRevenue: 1 }), DEFAULT_LEAD_RULES);
  assert.equal(v.qualified, true);
  assert.deepEqual(v.checks, []);
  assert.equal(v.summary, 'No filter set — every lead qualifies.');
});
