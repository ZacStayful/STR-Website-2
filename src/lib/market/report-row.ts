/**
 * One `analyser_reports` database row → the normalised `ReportRow` the
 * aggregator reads. Pure (no I/O) so it can be unit-tested; source.ts
 * (server-only) feeds it the raw rows.
 */
import { districtOf, normaliseOccupancy, type ReportRow } from './aggregate.ts';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function monthlyOf(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 12) return null;
  const nums = v.map(num);
  return nums.every((n): n is number => n !== null) ? nums : null;
}

export function toReportRow(raw: Record<string, unknown>): ReportRow {
  const postcode = typeof raw.postcode === 'string' ? raw.postcode : null;
  const area = typeof raw.postcode_area === 'string' && raw.postcode_area.trim() ? raw.postcode_area.trim().toUpperCase() : null;
  return {
    id: String(raw.id ?? ''),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    source: typeof raw.source === 'string' ? raw.source : 'unknown',
    postcode_area: area,
    district: districtOf(postcode),
    bedrooms: num(raw.bedrooms),
    adr: num(raw.adr),
    occupancy: normaliseOccupancy(num(raw.occupancy)),
    gross_revenue: num(raw.gross_revenue),
    net_revenue: num(raw.net_revenue),
    property_value_low: num(raw.property_value_low),
    property_value_high: num(raw.property_value_high),
    comp_avg_rating: num(raw.comp_avg_rating),
    comp_avg_review_count: num(raw.comp_avg_review_count),
    comp_avg_listing_age: num(raw.comp_avg_listing_age),
    listing_density: num(raw.listing_density),
    demand_hospitals: num(raw.demand_hospitals),
    demand_universities: num(raw.demand_universities),
    demand_transport: num(raw.demand_transport),
    demand_events: num(raw.demand_events),
    monthly: monthlyOf(raw.monthly),
    // The analyser's own verdict on the estimate; absent on the Monday backfill.
    // quality.ts decides from these whether the row is market data at all.
    comparables_found: num(raw.comparables_found),
    quality_level: typeof raw.quality_level === 'string' && raw.quality_level.trim() ? raw.quality_level.trim().toLowerCase() : null,
  };
}

