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
}

export interface MarketArea {
  postcode_area: string;
  total_sample_count: number;
  by_bedrooms: MarketBedroomAgg[];
}

export interface MarketStatsResponse {
  areas: MarketArea[];
  min_samples_threshold: number;
  generated_at: string;
}
