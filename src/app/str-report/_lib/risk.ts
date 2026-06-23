// Risk scoring engine.

import type { IncomeData, MarketData, PropertyInput, RiskData, RiskFactor, RiskRating } from "./types";
import { postcodeToSeed } from "./market";

function ratingFromScore(score: number): RiskRating {
  if (score <= 35) return "Low";
  if (score <= 60) return "Moderate";
  return "High";
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function stdDev(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function keyRiskText(factorLabel: string, input: PropertyInput): string {
  const map: Record<string, string> = {
    "Market saturation": `Competition is the primary exposure — there are a meaningful number of active listings in this area. Strong photography and a competitive ADR will be essential.`,
    "Seasonality volatility": `The main exposure is seasonal demand dips in Jan–Feb, where occupancy can drop to 55–60%. This is manageable with dynamic pricing but is the biggest variable to plan for.`,
    "Local regulation": `Local planning policy on short lets is the main risk to monitor. This is currently low but can shift — watch for council Article 4 direction changes.`,
    "Financial exposure": `The mortgage-to-income ratio means the property is sensitive to periods of lower occupancy. A 2-month void buffer reserve is recommended.`,
    "Demand stability": `Demand is concentrated in one or two driver categories. Diversifying guest types through pricing strategy reduces this exposure over time.`,
    "Management complexity": `${input.beds}-bed properties involve more moving parts — more cleaning time, higher guest expectations, and more consumables. Professional management significantly reduces this risk.`,
  };
  return map[factorLabel] ?? `Monitor ${factorLabel.toLowerCase()} closely in the first six months.`;
}

export function calculateRisk(input: PropertyInput, income: IncomeData, market: MarketData): RiskData {
  const seed = postcodeToSeed(input.postcode);

  // Factor 1: Market saturation (fewer listings = lower risk)
  const saturation = clamp(Math.round(30 + (market.listingCount - 240) * 0.15 + (seed % 8)), 10, 80);
  // Factor 2: Seasonality volatility (std dev of monthly occupancy)
  const volatility = clamp(Math.round(stdDev(market.monthlyOccupancy) * 5), 20, 75);
  // Factor 3: Local regulation (low by default, nudge by area)
  const regulation = clamp(15 + (seed % 20), 10, 50);
  // Factor 4: Financial exposure (mortgage as % of net income)
  const financialExposure =
    input.monthlyMortgage > 0 && income.net > 0
      ? clamp(Math.round((input.monthlyMortgage / income.net) * 40), 10, 80)
      : 25;
  // Factor 5: Demand stability (inverse of driver concentration)
  const demandStability = clamp(30 + (seed % 20), 20, 60);
  // Factor 6: Management complexity (beds and property type)
  const complexity = clamp(
    30 + (input.beds - 1) * 5 + (input.propertyType === "apartment" ? -5 : 5),
    20,
    65,
  );

  const factors: RiskFactor[] = [
    { label: "Market saturation", score: saturation, rating: ratingFromScore(saturation) },
    { label: "Seasonality volatility", score: volatility, rating: ratingFromScore(volatility) },
    { label: "Local regulation", score: regulation, rating: ratingFromScore(regulation) },
    { label: "Financial exposure", score: financialExposure, rating: ratingFromScore(financialExposure) },
    { label: "Demand stability", score: demandStability, rating: ratingFromScore(demandStability) },
    { label: "Management complexity", score: complexity, rating: ratingFromScore(complexity) },
  ];

  const overall = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
  const overallRating = ratingFromScore(overall);

  const worstFactor = [...factors].sort((a, b) => b.score - a.score)[0];
  const keyRisk = keyRiskText(worstFactor.label, input);

  return { factors, overall, overallRating, keyRisk };
}
