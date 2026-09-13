/**
 * Types for the Market Explorer data pipeline.
 *
 * Everything the explorer shows is built in one pass from the
 * `analyser_reports` table (see aggregate.ts), so a region, an area and a
 * district all carry the same `MarketAggregate` shape and every level shows
 * the same figures. Units are normalised by the aggregator:
 *   • avg_adr / revenue / property values — GBP
 *   • avg_occupancy — PERCENTAGE 0–100
 * Any average with no non-null source rows is `null` (never 0/NaN).
 */

export interface MarketBedroomAgg {
  bedrooms: number;
  sample_count: number;
  avg_adr: number | null;
  avg_occupancy: number | null; // 0–100
  avg_gross_revenue: number | null;
  avg_net_revenue: number | null;
  avg_property_value_low: number | null;
  avg_property_value_high: number | null;
  avg_rating?: number | null; // 0–5, reviewed comparables only
  avg_review_count?: number | null;
  avg_listing_age?: number | null; // years
  avg_listing_density?: number | null; // listings per km²
}

/** Competition summary for a level (averages over rows with review data). */
export interface AreaCompetitionRaw {
  sample_count: number;
  avg_rating: number | null;
  avg_review_count: number | null;
  avg_listing_age: number | null;
  avg_listing_density: number | null;
}

/** Demand-driver summary for a level. Shares are 0–1. */
export interface AreaDemandRaw {
  sample_count: number;
  share_hospital: number | null;
  share_university: number | null;
  share_transport: number | null;
  avg_events: number | null;
  large_planning_apps_12m: number | null;
  large_planning_apps_prev_12m: number | null;
  planning_fetched_at: string | null;
}

/** One month of analyser-report activity. */
export interface MonthBucket {
  month: string; // YYYY-MM (UTC)
  reports: number;
  avg_adr: number | null;
  avg_occupancy: number | null; // 0–100
  avg_gross_revenue: number | null;
  /** Reports that month carrying review data (optional: older fixtures lack it). */
  rated_reports?: number;
  avg_rating?: number | null; // 0–5
  avg_review_count?: number | null;
}

/** Mean revenue per calendar month (index 0 = January) over the reports that carry a monthly breakdown. */
export interface SeasonalityRaw {
  sample_count: number;
  monthly: number[]; // 12 values
}

/** The figures every level of the explorer carries. */
export interface MarketAggregate {
  total_sample_count: number;
  by_bedrooms: MarketBedroomAgg[];
  competition?: AreaCompetitionRaw | null;
  demand?: AreaDemandRaw | null;
  /** Last 12 months, oldest first, the running month last. */
  series?: MonthBucket[];
  seasonality?: SeasonalityRaw | null;
}

export interface MarketDistrict extends MarketAggregate {
  district: string; // outward code, e.g. NG7
  postcode_area: string;
}

export interface MarketArea extends MarketAggregate {
  postcode_area: string;
  districts?: MarketDistrict[];
}

export interface MarketRegion extends MarketAggregate {
  slug: string;
  name: string;
  /** Postcode areas in the region that have data, sorted. */
  areas: string[];
}

export interface MarketSnapshot {
  generated_at: string;
  months: string[];
  national: MonthBucket[];
  areas: MarketArea[];
  regions: MarketRegion[];
  total_reports: number;
}
