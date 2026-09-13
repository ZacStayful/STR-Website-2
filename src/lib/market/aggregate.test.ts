import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateRows, buildSnapshot, districtOf, monthKeys, normaliseOccupancy, type ReportRow } from './aggregate.ts';

let n = 0;
function row(p: Partial<ReportRow> = {}): ReportRow {
  n += 1;
  return {
    id: String(n), created_at: '2026-08-10T10:00:00Z', source: 'analyser', postcode_area: 'NG', district: 'NG7', bedrooms: 2,
    adr: 150, occupancy: 60, gross_revenue: 30000, net_revenue: 15000, property_value_low: 250000, property_value_high: 350000,
    comp_avg_rating: 4.8, comp_avg_review_count: 80, comp_avg_listing_age: 3, listing_density: null,
    demand_hospitals: 1, demand_universities: 0, demand_transport: 2, demand_events: 40, monthly: Array.from({ length: 12 }, () => 2500),
    ...p,
  };
}
const NOW = new Date('2026-09-13T00:00:00Z');
const MONTHS = monthKeys(NOW, 12);

test('districtOf takes the outward code of a full postcode only', () => {
  assert.equal(districtOf('NG7 2AB'), 'NG7');
  assert.equal(districtOf('ng72ab'), 'NG7');
  assert.equal(districtOf('M1 1AA'), 'M1');
  assert.equal(districtOf('EC1A 1BB'), 'EC1A');
  assert.equal(districtOf('SW1A 1AA'), 'SW1A');
  assert.equal(districtOf('NG7'), null);
  assert.equal(districtOf(null), null);
  assert.equal(districtOf(''), null);
});

test('occupancy is a percentage whichever unit the row used', () => {
  assert.equal(normaliseOccupancy(0.62), 62);
  assert.equal(normaliseOccupancy(62), 62);
  assert.equal(normaliseOccupancy(1), 100);
  assert.equal(normaliseOccupancy(null), null);
});

test('monthKeys ends with the running month', () => {
  assert.equal(MONTHS.length, 12);
  assert.equal(MONTHS[0], '2025-10');
  assert.equal(MONTHS[11], '2026-09');
});

test('backfill rows count in the totals and in the monthly series, and can be narrowed out', () => {
  const rows = [row(), row(), row({ source: 'monday_backfill', district: null, created_at: '2026-07-16T00:00:00Z', comp_avg_rating: null, comp_avg_review_count: null, monthly: null })];
  const agg = aggregateRows(rows, MONTHS);
  assert.equal(agg.total_sample_count, 3);
  assert.equal(agg.by_bedrooms[0].sample_count, 3);
  const july = agg.series!.find((b) => b.month === '2026-07')!;
  assert.equal(july.reports, 1);
  assert.equal(july.rated_reports, 0);
  assert.equal(aggregateRows(rows, MONTHS, { seriesSources: ['analyser'] }).series!.find((b) => b.month === '2026-07')!.reports, 0);
  const aug = agg.series!.find((b) => b.month === '2026-08')!;
  assert.equal(aug.reports, 2);
  assert.equal(aug.rated_reports, 2);
  assert.equal(aug.avg_rating, 4.8);
});

test('rows without a postcode belong to the area but to no district', () => {
  const snap = buildSnapshot([row(), row({ district: null }), row({ district: 'NG1' })], { now: NOW });
  assert.equal(snap.areas.length, 1);
  const ng = snap.areas[0];
  assert.equal(ng.total_sample_count, 3);
  assert.deepEqual(ng.districts!.map((d) => [d.district, d.total_sample_count]), [['NG1', 1], ['NG7', 1]].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
  assert.ok(ng.districts!.reduce((s, d) => s + d.total_sample_count, 0) <= ng.total_sample_count);
});

test('averages ignore nulls and zeros and are null when nothing qualifies', () => {
  const agg = aggregateRows([row({ adr: null, comp_avg_rating: 0, comp_avg_review_count: null }), row({ adr: 200 })], MONTHS);
  assert.equal(agg.by_bedrooms[0].avg_adr, 200);
  assert.equal(agg.competition!.sample_count, 1);
  assert.equal(agg.competition!.avg_rating, 4.8);
  const empty = aggregateRows([row({ adr: null, occupancy: null, comp_avg_rating: null, comp_avg_review_count: null, demand_hospitals: null, demand_universities: null, demand_transport: null, demand_events: null, monthly: null })], MONTHS);
  assert.equal(empty.by_bedrooms[0].avg_adr, null);
  assert.equal(empty.competition, null);
  assert.equal(empty.demand, null);
  assert.equal(empty.seasonality, null);
});

test('demand shares count rows with a driver over rows with a value', () => {
  const agg = aggregateRows([row({ demand_hospitals: 1 }), row({ demand_hospitals: 0 }), row({ demand_hospitals: 3 })], MONTHS);
  assert.ok(Math.abs(agg.demand!.share_hospital! - 2 / 3) < 1e-9);
  assert.equal(agg.demand!.avg_events, 40);
  assert.equal(agg.demand!.large_planning_apps_12m, null);
});

test('seasonality is the element-wise mean over valid twelve-month arrays', () => {
  const a = Array.from({ length: 12 }, (_, i) => (i === 6 ? 4000 : 2000));
  const b = Array.from({ length: 12 }, (_, i) => (i === 6 ? 6000 : 2000));
  const agg = aggregateRows([row({ monthly: a }), row({ monthly: b }), row({ monthly: a.slice(0, 11) })], MONTHS);
  assert.equal(agg.seasonality!.sample_count, 2);
  assert.equal(agg.seasonality!.monthly[6], 5000);
  assert.equal(agg.seasonality!.monthly[0], 2000);
});

test('rows with no revenue are dropped before anything is counted', () => {
  const snap = buildSnapshot([row(), row({ gross_revenue: 0 }), row({ gross_revenue: null })], { now: NOW });
  assert.equal(snap.total_reports, 1);
  assert.equal(snap.areas[0].total_sample_count, 1);
});

test('regions union their areas at row level and the national series covers everyone', () => {
  const rows = [row({ postcode_area: 'M', district: 'M1' }), row({ postcode_area: 'L', district: 'L1' }), row({ postcode_area: 'EH', district: 'EH1' })];
  const snap = buildSnapshot(rows, { now: NOW });
  assert.equal(snap.regions.length, 2);
  const nw = snap.regions.find((r) => r.slug === 'north-west')!;
  assert.equal(nw.name, 'North West');
  assert.equal(nw.total_sample_count, 2);
  assert.deepEqual(nw.areas, ['L', 'M']);
  assert.equal(snap.regions.find((r) => r.slug === 'scotland')!.total_sample_count, 1);
  assert.equal(snap.national.find((b) => b.month === '2026-08')!.reports, 3);
  assert.equal(snap.generated_at, NOW.toISOString());
  assert.equal(snap.months.length, 12);
});

test('planning signals reach the area, its districts and the region mean', () => {
  const rows = [row({ postcode_area: 'M', district: 'M1' }), row({ postcode_area: 'L', district: 'L1' }), row({ postcode_area: 'EH', district: 'EH1' })];
  const planning = [
    { postcode_area: 'M', large_apps_12m: 40, large_apps_prev_12m: 20, fetched_at: '2026-09-01T00:00:00Z' },
    { postcode_area: 'l', large_apps_12m: 10, large_apps_prev_12m: 10, fetched_at: '2026-08-01T00:00:00Z' },
  ];
  const snap = buildSnapshot(rows, { now: NOW, planning });
  const m = snap.areas.find((a) => a.postcode_area === 'M')!;
  assert.equal(m.demand!.large_planning_apps_12m, 40);
  assert.equal(m.demand!.large_planning_apps_prev_12m, 20);
  assert.equal(m.districts![0].demand!.large_planning_apps_12m, 40);
  const nw = snap.regions.find((r) => r.slug === 'north-west')!;
  assert.equal(nw.demand!.large_planning_apps_12m, 25);
  assert.equal(nw.demand!.planning_fetched_at, '2026-08-01T00:00:00Z');
  assert.equal(snap.areas.find((a) => a.postcode_area === 'EH')!.demand!.large_planning_apps_12m, null);
});

test('a planning signal alone gives an area demand data', () => {
  const bare = row({ demand_hospitals: null, demand_universities: null, demand_transport: null, demand_events: null });
  const none = aggregateRows([bare], MONTHS);
  assert.equal(none.demand, null);
  const withPlanning = aggregateRows([bare], MONTHS, {}, { large_planning_apps_12m: 12, large_planning_apps_prev_12m: 9, planning_fetched_at: '2026-09-01T00:00:00Z' });
  assert.equal(withPlanning.demand!.large_planning_apps_12m, 12);
  assert.equal(withPlanning.demand!.share_hospital, null);
});
