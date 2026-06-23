// Pure calculation engine — no side effects.

import type { IncomeData } from "./types";

// Average daily rate defaults by bedroom count
export const ADR_DEFAULTS: Record<number, number> = {
  1: 90,
  2: 112,
  3: 140,
  4: 168,
};

// Monthly occupancy baseline (Jan–Dec, %)
export const MONTHLY_OCCUPANCY = [55, 58, 65, 70, 78, 82, 85, 88, 80, 72, 60, 54];

// Average annual occupancy = 71%
export const AVG_OCCUPANCY = 0.71;

export function grossMonthlyIncome(beds: number): number {
  const adr = ADR_DEFAULTS[beds] ?? 112;
  // Average days per month × average annual occupancy
  return Math.round(adr * 30.4 * AVG_OCCUPANCY);
}

export function managementFee(gross: number): number {
  // 15% + 20% VAT = 18% of gross
  return Math.round(gross * 0.18);
}

// Cleaning cost per month by bedroom count
export const CLEANING_MONTHLY: Record<number, number> = {
  1: 280, // ~£65/stay × ~4.3 stays
  2: 340, // ~£82/stay × ~4.1 stays
  3: 420, // ~£105/stay × ~4.0 stays
  4: 540, // ~£135/stay × ~4.0 stays
};

export const CONSUMABLES_MONTHLY = 55;

export function voidAllowance(gross: number): number {
  return Math.round(gross * 0.08);
}

export function calculateIncome(beds: number): IncomeData {
  const gross = grossMonthlyIncome(beds);
  const management = managementFee(gross);
  const cleaning = CLEANING_MONTHLY[beds] ?? 340;
  const consumables = CONSUMABLES_MONTHLY;
  const voidAllowance_ = voidAllowance(gross);
  const net = gross - management - cleaning - consumables - voidAllowance_;
  return {
    gross,
    management,
    cleaning,
    consumables,
    voidAllowance: voidAllowance_,
    net,
    netMultiplier: parseFloat((net / gross).toFixed(2)),
    annualNet: net * 12,
  };
}

// Re-derive an IncomeData when the user opts to self-manage (drops the
// management fee entirely and folds it back into net). Pure — used by the
// income chapter toggle and the downstream compare/verdict chapters.
export function applySelfManaged(income: IncomeData, selfManaged: boolean): IncomeData {
  if (!selfManaged) return income;
  const net = income.net + income.management;
  return {
    ...income,
    management: 0,
    net,
    netMultiplier: parseFloat((net / income.gross).toFixed(2)),
    annualNet: net * 12,
  };
}

// Long-let net income estimate by bedroom count (UK mid-range defaults)
export const LTL_DEFAULTS: Record<number, number> = {
  1: 720,
  2: 920,
  3: 1120,
  4: 1390,
};

export function ltlEstimate(beds: number): number {
  return LTL_DEFAULTS[beds] ?? 920;
}

// One-time setup / furnishing costs by bedroom count
export const SETUP_COSTS: Record<number, number> = {
  1: 3250,
  2: 5250,
  3: 7750,
  4: 10500,
};

export function setupCost(beds: number): number {
  return SETUP_COSTS[beds] ?? 5250;
}

export function upliftPct(strNet: number, ltlNet: number): number {
  return Math.round(((strNet - ltlNet) / ltlNet) * 100);
}

export function paybackMonths(setup: number, monthlyUplift: number): number {
  if (monthlyUplift <= 0) return 999;
  return Math.ceil(setup / monthlyUplift);
}
