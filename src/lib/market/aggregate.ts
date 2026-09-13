/**
 * Pure aggregation of analyser reports into the Market Explorer snapshot.
 *
 * One pass over the rows produces every level (region › area › district)
 * with the same figures, the monthly series behind the trend charts and the
 * inputs for seasonality and competition, so nothing on the explorer can
 * come from two different snapshots. No I/O here: source.ts loads the rows
 * (server-only) and hands them in already normalised.
 *
 * Rules:
 *   • a row needs gross_revenue > 0 to count at all
 *   • occupancy is 0–100 (source.ts normalises ≤1 → ×100)
 *   • the district is the postcode's outward code; rows without a full
 *     postcode (the Monday backfill) count for their area and region only
 *   • the monthly series only takes real analyser runs by default: the
 *     backfill carries one artificial date and would read as a spike
 *   • every average ignores nulls and non-positive values and is null when
 *     nothing qualifies (never 0 or NaN)
 */

import { regionForArea } from './regions.ts';
import type { AreaCompetitionRaw, AreaDemandRaw, MarketAggregate, MarketArea, MarketBedroomAgg, MarketDistrict, MarketRegion, MarketSnapshot, MonthBucket, SeasonalityRaw } from './types.ts';

export interface ReportRow {
  id: string;
  created_at: string;
  source: string;
  postcode_area: string | null;
  district: string | null;
  bedrooms: number | null;
  adr: number | null;
  occupancy: number | null; // 0–100
  gross_revenue: number | null;
  net_revenue: number | null;
  property_value_low: number | null;
  property_value_high: number | null;
  comp_avg_rating: number | null;
  comp_avg_review_count: number | null;
  comp_avg_listing_age: number | null;
  listing_density: number | null;
  demand_hospitals: number | null;
  demand_universities: number | null;
  demand_transport: number | null;
  demand_events: number | null;
  /** 12 monthly revenue figures, January first, or null. */
  monthly: number[] | null;
}

export interface AggregateOptions {
  now?: Date;
  /** Months in the trend window, the running month included. */
  months?: number;
  /** Row sources that feed the monthly series. */
  seriesSources?: readonly string[];
}

export const DEFAULT_SERIES_SOURCES: readonly string[] = ['analyser'];
const DEFAULT_MONTHS = 12;

const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** The outward code of a full UK postcode ("NG7 2AB" → "NG7"); null without an inward part. */
export function districtOf(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const m = postcode.trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (m) return m[1];
  const spaced = postcode.trim().toUpperCase().match(FULL_POSTCODE);
  return spaced ? spaced[1] : null;
}

/** Occupancy as a percentage: the table mixes 0–1 and 0–100. */
export function normaliseOccupancy(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v <= 1 ? Math.round(v * 100 * 1000) / 1000 : v;
}

/** 'YYYY-MM' keys, oldest first, ending with the running month. */
export function monthKeys(now: Date, months = DEFAULT_MONTHS): string[] {
  const out: string[] = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function positive(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function meanOf(rows: ReportRow[], pick: (r: ReportRow) => number | null): number | null {
  return mean(rows.map(pick).filter(positive));
}

function bedroomGroups(rows: ReportRow[]): MarketBedroomAgg[] {
  const groups = new Map<number, ReportRow[]>();
  for (const r of rows) {
    if (r.bedrooms === null || !Number.isFinite(r.bedrooms)) continue;
    const list = groups.get(r.bedrooms) ?? [];
    list.push(r);
    groups.set(r.bedrooms, list);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bedrooms, g]) => ({
      bedrooms,
      sample_count: g.length,
      avg_adr: meanOf(g, (r) => r.adr),
      avg_occupancy: meanOf(g, (r) => r.occupancy),
      avg_gross_revenue: meanOf(g, (r) => r.gross_revenue),
      avg_net_revenue: meanOf(g, (r) => r.net_revenue),
      avg_property_value_low: meanOf(g, (r) => r.property_value_low),
      avg_property_value_high: meanOf(g, (r) => r.property_value_high),
      avg_rating: meanOf(g, (r) => r.comp_avg_rating),
      avg_review_count: meanOf(g, (r) => r.comp_avg_review_count),
      avg_listing_age: meanOf(g, (r) => r.comp_avg_listing_age),
      avg_listing_density: meanOf(g, (r) => r.listing_density),
    }));
}

function hasReviewData(r: ReportRow): boolean {
  return positive(r.comp_avg_rating) || positive(r.comp_avg_review_count);
}

function competitionOf(rows: ReportRow[]): AreaCompetitionRaw | null {
  const rated = rows.filter(hasReviewData);
  if (rated.length === 0) return null;
  return {
    sample_count: rated.length,
    avg_rating: meanOf(rated, (r) => r.comp_avg_rating),
    avg_review_count: meanOf(rated, (r) => r.comp_avg_review_count),
    avg_listing_age: meanOf(rows, (r) => r.comp_avg_listing_age),
    avg_listing_density: meanOf(rows, (r) => r.listing_density),
  };
}

function share(rows: ReportRow[], pick: (r: ReportRow) => number | null): number | null {
  const known = rows.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return null;
  return known.filter((v) => v > 0).length / known.length;
}

function demandOf(rows: ReportRow[]): AreaDemandRaw | null {
  const withData = rows.filter((r) => [r.demand_hospitals, r.demand_universities, r.demand_transport, r.demand_events].some((v) => v !== null && Number.isFinite(v)));
  if (withData.length === 0) return null;
  const events = withData.map((r) => r.demand_events).filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  return {
    sample_count: withData.length,
    share_hospital: share(withData, (r) => r.demand_hospitals),
    share_university: share(withData, (r) => r.demand_universities),
    share_transport: share(withData, (r) => r.demand_transport),
    avg_events: mean(events),
    large_planning_apps_12m: null,
    large_planning_apps_prev_12m: null,
    planning_fetched_at: null,
  };
}

function validMonthly(r: ReportRow): r is ReportRow & { monthly: number[] } {
  return Array.isArray(r.monthly) && r.monthly.length === 12 && r.monthly.every((v) => Number.isFinite(v) && v >= 0) && r.monthly.some((v) => v > 0);
}

function seasonalityOf(rows: ReportRow[]): SeasonalityRaw | null {
  const withMonthly = rows.filter(validMonthly);
  if (withMonthly.length === 0) return null;
  const monthly = Array.from({ length: 12 }, (_, i) => withMonthly.reduce((s, r) => s + r.monthly[i], 0) / withMonthly.length);
  return { sample_count: withMonthly.length, monthly };
}

function seriesOf(rows: ReportRow[], months: string[], sources: readonly string[]): MonthBucket[] {
  const byMonth = new Map<string, ReportRow[]>();
  for (const r of rows) {
    if (!sources.includes(r.source)) continue;
    const key = r.created_at.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }
  return months.map((month) => {
    const g = byMonth.get(month) ?? [];
    const rated = g.filter(hasReviewData);
    return {
      month,
      reports: g.length,
      avg_adr: meanOf(g, (r) => r.adr),
      avg_occupancy: meanOf(g, (r) => r.occupancy),
      avg_gross_revenue: meanOf(g, (r) => r.gross_revenue),
      rated_reports: rated.length,
      avg_rating: meanOf(rated, (r) => r.comp_avg_rating),
      avg_review_count: meanOf(rated, (r) => r.comp_avg_review_count),
    };
  });
}

/** The figures for one level (region, area or district) from its rows. */
export function aggregateRows(rows: ReportRow[], months: string[], opts: AggregateOptions = {}): MarketAggregate {
  return {
    total_sample_count: rows.length,
    by_bedrooms: bedroomGroups(rows),
    competition: competitionOf(rows),
    demand: demandOf(rows),
    series: seriesOf(rows, months, opts.seriesSources ?? DEFAULT_SERIES_SOURCES),
    seasonality: seasonalityOf(rows),
  };
}

function groupBy(rows: ReportRow[], key: (r: ReportRow) => string | null): Map<string, ReportRow[]> {
  const out = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** The whole explorer snapshot: regions, areas (with districts) and the national series. */
export function buildSnapshot(input: ReportRow[], opts: AggregateOptions = {}): MarketSnapshot {
  const now = opts.now ?? new Date();
  const months = monthKeys(now, opts.months ?? DEFAULT_MONTHS);
  const rows = input.filter((r) => positive(r.gross_revenue));

  const byArea = groupBy(rows, (r) => (r.postcode_area ? r.postcode_area.trim().toUpperCase() : null));
  const areas: MarketArea[] = [...byArea.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([postcode_area, areaRows]) => {
      const byDistrict = groupBy(areaRows, (r) => r.district);
      const districts: MarketDistrict[] = [...byDistrict.entries()]
        .map(([district, districtRows]) => ({ district, postcode_area, ...aggregateRows(districtRows, months, opts) }))
        .sort((a, b) => b.total_sample_count - a.total_sample_count || a.district.localeCompare(b.district));
      return { postcode_area, ...aggregateRows(areaRows, months, opts), districts };
    });

  const byRegion = groupBy(rows, (r) => (r.postcode_area ? regionForArea(r.postcode_area).slug : null));
  const regions: MarketRegion[] = [...byRegion.entries()]
    .map(([slug, regionRows]) => {
      const meta = regionForArea(regionRows[0].postcode_area);
      const areaCodes = [...new Set(regionRows.map((r) => r.postcode_area!.trim().toUpperCase()))].sort();
      return { slug, name: meta.slug === slug ? meta.name : slug, areas: areaCodes, ...aggregateRows(regionRows, months, opts) };
    })
    .sort((a, b) => b.total_sample_count - a.total_sample_count || a.name.localeCompare(b.name));

  return {
    generated_at: now.toISOString(),
    months,
    national: seriesOf(rows, months, opts.seriesSources ?? DEFAULT_SERIES_SOURCES),
    areas,
    regions,
    total_reports: rows.length,
  };
}
