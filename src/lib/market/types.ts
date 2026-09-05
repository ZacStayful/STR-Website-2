/**
 * Types for the Market Explorer data pipeline.
 *
 * `MarketStatsResponse` mirrors exactly what the internal
 * `/api/market-stats` endpoint (Stayful-STR-estimate-software) returns.
 * Units are already normalised by the endpoint:
 *   • avg_adr / revenue / property values — GBP
 *   • avg_occupancy — PERCENTAGE 0–100 (already unit-corrected server-side)
 * Any average with no non-null source rows comes back as `null` (never 0/NaN).
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
  // Market signals (Phase 2 backend; optional so an older backend still parses)
  avg_rating?: number | null; // 0–5, reviewed comparables only
  avg_review_count?: number | null;
  avg_listing_age?: number | null; // years
  avg_listing_density?: number | null; // listings per km²
}

/** Per-area competition summary from the backend (averages over rows with data). */
export interface AreaCompetitionRaw {
  sample_count: number;
  avg_rating: number | null;
  avg_review_count: number | null;
  avg_listing_age: number | null;
  avg_listing_density: number | null;
}

/** Per-area demand-driver summary from the backend. Shares are 0–1. */
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

export interface MarketArea {
  postcode_area: string;
  total_sample_count: number;
  by_bedrooms: MarketBedroomAgg[];
  competition?: AreaCompetitionRaw | null;
  demand?: AreaDemandRaw | null;
}

export interface MarketStatsResponse {
  areas: MarketArea[];
  min_samples_threshold: number;
  generated_at: string;
}
