// Location intelligence: direct-booking score, why-people-book reasons,
// local-area analysis and area competitiveness. Deterministic, seeded from the
// postcode + market data (Phase 2 would swap these for real signals).

import type { MarketData, PropertyInput, RiskRating } from "./types";
import { postcodeToSeed } from "./market";

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// 0–100. Higher = stronger potential to convert guests into repeat / direct
// bookings (diverse demand, healthy occupancy, not over-saturated).
export function directBookingScore(input: PropertyInput, market: MarketData): number {
  const seed = postcodeToSeed(input.postcode);
  const topShare = Math.max(...market.demandDrivers.map((d) => d.percentage)) / 100;
  const diversity = 1 - topShare; // even spread of demand → more repeat potential
  const saturationPenalty = clamp((market.listingCount - 240) * 0.05, 0, 12);
  const raw =
    market.avgOccupancy * 0.6 + diversity * 42 + (input.beds >= 3 ? 4 : 0) + (seed % 10) - saturationPenalty;
  return clamp(Math.round(raw), 0, 100);
}

export function directBookingRating(score: number): { rating: RiskRating; label: string } {
  if (score >= 70) return { rating: "Low", label: "Strong" };
  if (score >= 50) return { rating: "Moderate", label: "Moderate" };
  return { rating: "High", label: "Limited" };
}

export interface BookReason {
  title: string;
  detail: string;
  share: number;
}

const REASON_DETAIL: Record<string, string> = {
  "Business travellers":
    "Steady midweek demand from nearby employers, offices and project sites — the backbone of year-round occupancy.",
  "Leisure weekends":
    "Couples and small groups booking short weekend breaks, driving premium Friday–Sunday rates.",
  "Contractor stays":
    "Multi-week contractor bookings that smooth out the quieter months and reduce turnover costs.",
  "Events & tourism":
    "Demand spikes around local venues, sport and seasonal attractions — your best opportunity for peak pricing.",
};

export function whyBookReasons(_input: PropertyInput, market: MarketData): BookReason[] {
  return market.demandDrivers.map((d) => ({
    title: d.label,
    share: d.percentage,
    detail: REASON_DETAIL[d.label] ?? "A meaningful share of local short-let demand.",
  }));
}

export interface LocalArea {
  summary: string;
  highlights: { label: string; value: string }[];
}

export function localAreaAnalysis(input: PropertyInput, market: MarketData): LocalArea {
  const seed = postcodeToSeed(input.postcode);
  const profiles = ["Urban / commuter", "City-centre", "Suburban", "Town-centre"];
  const profile = profiles[seed % profiles.length];
  const transport = ["Strong rail & bus links", "Walkable to the station", "Good road & motorway access", "Direct city-centre transport"][seed % 4];
  const walkScore = clamp(62 + (seed % 30), 55, 96);
  const guestRating = (4.5 + ((seed % 5) / 10)).toFixed(2);
  const amenities = ["High street within 0.5 mi", "Cafés & restaurants nearby", "Supermarket within walking distance", "Green space close by"][seed % 4];

  const summary =
    `This is a ${profile.toLowerCase()} location with ${transport.toLowerCase()}. ` +
    `Comparable short lets here run at ${market.avgOccupancy}% average occupancy across the year, with a healthy spread of guest types. ` +
    `Guest sentiment in the area is strong (${guestRating}★ average), and everyday amenities are within easy reach — the practical things that turn a one-off stay into a five-star review.`;

  return {
    summary,
    highlights: [
      { label: "Area profile", value: profile },
      { label: "Transport", value: transport },
      { label: "Walkability", value: `${walkScore} / 100` },
      { label: "Guest sentiment", value: `${guestRating}★ avg nearby` },
      { label: "Amenities", value: amenities },
      { label: "Median gross / mo", value: `£${market.medianGrossMonthly.toLocaleString()}` },
    ],
  };
}

export interface Competitiveness {
  score: number; // 0–100, higher = more saturated / competitive
  rating: RiskRating;
  summary: string;
}

export function competitiveness(market: MarketData): Competitiveness {
  const score = clamp(Math.round((market.listingCount - 180) * 0.4), 10, 95);
  let rating: RiskRating;
  let summary: string;
  if (score <= 35) {
    rating = "Low";
    summary = `With ${market.listingCount} active listings nearby, supply is relatively light — there's room for a well-presented property to stand out and command strong occupancy.`;
  } else if (score <= 60) {
    rating = "Moderate";
    summary = `At ${market.listingCount} active listings, the area is moderately competitive. Professional photography, dynamic pricing and a complete amenity list will be what separates you from the pack.`;
  } else {
    rating = "High";
    summary = `${market.listingCount} active listings makes this a busy, competitive market. Winning here depends on a polished listing, sharp pricing and excellent reviews — achievable, but it has to be done well.`;
  }
  return { score, rating, summary };
}
