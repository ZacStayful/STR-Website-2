// Types for the STR Intelligence Report experience.

export type ChapterState = 0 | 1 | 2 | 3 | 4 | 5 | 6;
// 0 = input, 1 = scanning, 2 = market, 3 = income, 4 = compare, 5 = risk, 6 = verdict

export type Beds = 1 | 2 | 3 | 4;
export type PropertyType = "apartment" | "terraced" | "semi-detached" | "detached";

export interface PropertyInput {
  postcode: string;
  beds: Beds;
  propertyType: PropertyType;
  monthlyMortgage: number;
}

export interface MarketData {
  listingCount: number;
  avgDailyRate: number;
  avgOccupancy: number;
  medianGrossMonthly: number;
  monthlyOccupancy: number[]; // 12 values Jan–Dec
  demandDrivers: { label: string; percentage: number }[];
}

export interface IncomeData {
  gross: number;
  management: number;
  cleaning: number;
  consumables: number;
  voidAllowance: number;
  net: number;
  netMultiplier: number;
  annualNet: number;
}

export type RiskRating = "Low" | "Moderate" | "High";

export interface RiskFactor {
  label: string;
  score: number; // 0–100
  rating: RiskRating;
}

export interface RiskData {
  factors: RiskFactor[];
  overall: number;
  overallRating: RiskRating;
  keyRisk: string;
}

export type VerdictResult = "strong-yes" | "yes" | "borderline" | "no";

export interface VerdictData {
  result: VerdictResult;
  headline: string;
  summary: string;
  upliftPct: number;
  upliftAmount: number;
  setupPaybackMonths: number;
}
