import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTabModel, isTabKey, TAB_KEYS, type TabContext } from './tab-model.ts';
import type { AreaCardData, DistrictCardData, LevelFigures } from './explorer.ts';

function figures(over: Partial<LevelFigures> = {}): LevelFigures {
  return {
    headline: { grossRevenue: 27400, adr: 128, occupancy: 58, totalSamples: 14, bedroomsAvailable: [1, 2, 3] },
    byBedrooms: [
      { bedrooms: 1, samples: 4, adr: 90, occupancy: 62, grossRevenue: 19700, propertyValueLow: 200000, propertyValueHigh: 240000, propertyValueMid: 220000, grossYieldPct: 9 },
      { bedrooms: 2, samples: 6, adr: 122, occupancy: 58, grossRevenue: 26900, propertyValueLow: null, propertyValueHigh: null, propertyValueMid: null, grossYieldPct: null },
      { bedrooms: 3, samples: 4, adr: 177, occupancy: 53, grossRevenue: 36200, propertyValueLow: 400000, propertyValueHigh: 480000, propertyValueMid: 440000, grossYieldPct: 8.2 },
    ],
    yieldOnCost: { grossYieldPct: 7.2, netYieldPct: null, propertyValueMid: 380000, grossRevenue: 27400, sampleCount: 8 },
    confidence: { tier: 'confirmed', rank: 3, label: 'Confirmed', blurb: '' },
    competition: { label: 'Opportunity', tone: 'works', intensity: 38, rating: 4.85, reviews: 60, sampleCount: 5, explanation: 'x' },
    seasonality: { score: 78, label: 'Steady', cv: 0.2, peakMonth: 7, lowMonth: 0, profile: Array(12).fill(1 / 12), peakShare: 0.12, lowShare: 0.06, sampleCount: 6, explanation: 'Even.' },
    directBooking: { score: 64, label: 'Moderate', components: [], sampleCount: 5, contractorTrend: null },
    ratedReports: 5,
    monthlyReports: 6,
    series: [
      { month: '2025-10', reports: 3, avg_adr: 110, avg_occupancy: 55, avg_gross_revenue: 25000 },
      { month: '2025-11', reports: 1, avg_adr: 999, avg_occupancy: 10, avg_gross_revenue: 1 },
      { month: '2026-01', reports: 4, avg_adr: 140, avg_occupancy: 60, avg_gross_revenue: 29000 },
    ],
    listingDensity: 12.3,
    listingAge: 2.5,
    ...over,
  };
}

function district(code: string, ready: boolean): DistrictCardData {
  const f = figures({ headline: { grossRevenue: ready ? 29800 : null, adr: ready ? 134 : null, occupancy: ready ? 61 : null, totalSamples: ready ? 6 : 2, bedroomsAvailable: [2] } });
  return { ...f, code, areaCode: 'NG', ready };
}

function area(over: Partial<AreaCardData> = {}): AreaCardData {
  return {
    ...figures(),
    code: 'NG', slug: 'nottingham', name: 'Nottingham', region: { slug: 'east-midlands', name: 'East Midlands' },
    verdict: { financials: { shortLetGrossAnnual: 27400, shortLetNetAnnual: 17000, longLetGrossAnnual: 13800, longLetNetAnnual: 11700, monthlyDifference: 441, annualDifference: 5300, breakEvenOccupancy: 40 }, winner: 'short-let', annualAdvantage: 5300, monthlyAdvantage: 441, breakEvenOccupancyPct: 40, longLetMonthlyRent: 1150 },
    licensing: { postcodeArea: 'NG', nation: 'England', regionLabel: 'Nottingham City Council', status: 'confirmed-unrestricted', headline: 'No licence needed', detail: 'No licensing scheme applies.', sources: ['https://www.nottinghamcity.gov.uk/x'], lastVerified: '2026-08-01' },
    score: { score: 74, grade: 'B', gradeLabel: 'Strong', partial: false, components: [{ key: 'regulatory', label: 'Regulatory ease', weight: 15, earned: 15, detail: 'unrestricted' }] },
    managedByStayful: false,
    districts: [district('NG1', true), district('NG9', false)],
    ...over,
  };
}

function ctx(a: AreaCardData, over: Partial<TabContext> = {}): TabContext {
  return { area: a, scope: a, scopeName: a.name, isDistrict: false, bedroom: null, trend: null, goals: null, ...over };
}

const DATA_TABS = TAB_KEYS.filter((k) => k !== 'overview' && k !== 'deals');

test('every tab builds for a fully populated area and never says "past year"', () => {
  const a = area();
  for (const tab of DATA_TABS) {
    const m = buildTabModel(tab, ctx(a));
    assert.ok(m.title, tab);
    const text = JSON.stringify(m);
    assert.doesNotMatch(text, /past year/i, tab);
  }
});

test('every tab degrades for an area with nothing but a headline', () => {
  const bare = area({ ...figures({ competition: null, seasonality: null, directBooking: null, yieldOnCost: null, series: [], byBedrooms: [], listingDensity: null, ratedReports: 0, monthlyReports: 0 }), verdict: null, score: null, districts: [] });
  for (const tab of DATA_TABS) {
    const m = buildTabModel(tab, ctx(bare));
    assert.ok(m.title, tab);
    for (const k of m.kpis) assert.equal(typeof k.value, 'string', `${tab} ${k.label}`);
  }
  assert.match(buildTabModel('longlet', ctx(bare)).desc, /No area long-let comparator/);
  assert.equal(buildTabModel('seasonality', ctx(bare)).extra, undefined);
  assert.match(buildTabModel('submarkets', ctx(bare)).empty ?? '', /cannot be split/);
});

test('licensing renders the entry, not invented rules', () => {
  const m = buildTabModel('licensing', ctx(area()));
  assert.equal(m.kpis[0].value, 'No licence needed');
  assert.equal(m.kpis[1].value, '15 / 15');
  assert.equal(m.kpis[3].value, '2026-08-01');
  assert.deepEqual(m.links, [{ label: 'www.nottinghamcity.gov.uk', href: 'https://www.nottinghamcity.gov.uk/x' }]);
  assert.doesNotMatch(JSON.stringify(m), /90-night|business rates/i);
});

test('long-let working comes from the shared financials', () => {
  const m = buildTabModel('longlet', ctx(area()));
  assert.equal(m.kpis[0].value, 'Short-let ahead');
  assert.equal(m.kpis[1].value, '£17,000');
  assert.equal(m.kv!.rows.find((r) => r.k === 'Long-let net')!.v, '£11,700');
  const tossUp = area({ verdict: { ...area().verdict!, winner: 'toss-up' } });
  assert.equal(buildTabModel('longlet', ctx(tossUp)).kpis[0].value, 'Close call');
});

test('rates ignores thin months and sub-markets orders ready districts first', () => {
  const rates = buildTabModel('rates', ctx(area()));
  assert.equal(rates.kpis[1].value, '£140'); // the 999 month had 1 report
  assert.equal(rates.kpis[2].value, '£110');
  const sub = buildTabModel('submarkets', ctx(area()));
  assert.deepEqual(sub.table!.rows.map((r) => r.key), ['NG1', 'NG9']);
  assert.equal(sub.table!.rows[1].muted, true);
  assert.match(sub.table!.rows[1].cells.at(-1)!, /1 more report needed/);
  assert.equal(sub.kpis[0].value, '1 of 2');
});

test('bedroom table highlights the bedroom in play and shows dashes for missing values', () => {
  const m = buildTabModel('revenue', ctx(area(), { bedroom: 2 }));
  const two = m.table!.rows.find((r) => r.key === '2')!;
  assert.equal(two.highlight, true);
  assert.equal(two.cells[5], '—');
  assert.equal(m.kpis[3].value, '3-bed');
});

test('district scope notes what follows the area', () => {
  const a = area();
  const m = buildTabModel('licensing', ctx(a, { scope: a.districts[0], scopeName: 'Nottingham NG1', isDistrict: true }));
  assert.match(m.desc, /follow the postcode area/);
});

test('isTabKey', () => {
  assert.equal(isTabKey('rates'), true);
  assert.equal(isTabKey('bogus'), false);
});
