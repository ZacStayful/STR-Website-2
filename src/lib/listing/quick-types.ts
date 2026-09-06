/**
 * Client-safe types for the quick view a member sees before running a full
 * report. Produced by src/lib/listing/quick.ts (server), rendered by the
 * analyser's source card and the explorer's Listing tab.
 */
import type { Deal } from './deal.ts';
import type { CompetitorSummary, TrackedListing } from './competitors.ts';

/** Property Market Intel's own projection for the property (full reports only). */
export interface SecondOpinion {
  annualRevenue: number;
  adr: number | null;
  occupancy: number | null; // 0–100
  confidence: 'high' | 'medium' | 'low';
  rangeLow: number | null;
  rangeHigh: number | null;
  monthly: { month: string; revenue: number }[];
  comparables: { listingId: string | null; title: string; revenue: number | null; adr: number | null; occupancy: number | null; rating: number | null; url: string | null; distanceM: number | null }[];
}

export type EstimateSource = 'postcode-reports' | 'competitors' | 'area-bedrooms' | 'area' | 'pmi-market';

export interface QuickArea {
  code: string;
  slug: string;
  name: string;
  score: number | null;
  grade: string | null;
  gradeLabel: string | null;
  confidence: { tier: string; label: string };
  competition: { label: string; percentile: number } | null;
  directBooking: { score: number; label: string } | null;
  licensing: { status: string; headline: string };
  managedByStayful: boolean;
  trend: { direction: string; label: string } | null;
  /** Figures for the requested bedroom count when the area has them. */
  bedroomStat: { bedrooms: number; samples: number; grossRevenue: number | null; adr: number | null; occupancy: number | null } | null;
  headline: { grossRevenue: number | null; adr: number | null; occupancy: number | null; totalSamples: number };
}

export interface QuickEstimateFigures {
  grossRevenue: number;
  adr: number | null;
  occupancy: number | null; // 0–100
  source: EstimateSource;
  note: string;
  updatedAt: string | null;
  stale: boolean;
}

export interface QuickCompetitors {
  summary: CompetitorSummary;
  top: TrackedListing[];
  cell: string;
  updatedAt: string | null;
  stale: boolean;
}

export interface QuickEstimate {
  area: QuickArea | null;
  estimate: QuickEstimateFigures | null;
  competitors: QuickCompetitors | null;
  /** The pasted Airbnb listing's own tracked performance, when a provider has it. */
  tracked: (TrackedListing & { provider: string; updatedAt: string | null }) | null;
  /** True when we looked for tracked performance and no provider had it. */
  trackedMissing: boolean;
  pmiMarket: { adr: number | null; occupancy: number | null; revenueAnnual: number | null; activeListings: number | null; supplyGrowthPct: number | null; grade: string | null; updatedAt: string | null } | null;
  deal: Deal | null;
  /** Provider budget stopped a lookup; the UI says so instead of showing nothing. */
  limited: boolean;
}
