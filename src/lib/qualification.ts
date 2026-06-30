/**
 * Short-Let vs Long-Let "Qualification Decision".
 *
 * Single source of truth for the decision maths. The UI derives every figure
 * from these functions so it can never drift from the numbers the
 * recommendation is based on.
 *
 * The decision deliberately uses a MORE conservative "true net" (44% of gross,
 * minus fixed bills/software) than the full report's headline "Net Revenue"
 * (~52%, after only platform + management + cleaning). The take-home waterfall
 * bridge (getCostBreakdown) exists to reconcile the two — don't unify them.
 */

// Short-let running costs as fractions of GROSS revenue.
// The first three are exactly what the full report deducts to reach its
// headline "Net Revenue". The decision goes further (VAT + maintenance + fixed).
export const STR_COST_RATES = {
  platform: 0.15,        // booking platform fee
  managementBase: 0.15,  // management fee (ex-VAT)
  managementVat: 0.03,   // VAT on the 15% management fee (15% × 20%)
  cleaning: 0.18,        // cleaning & laundry
  maintenance: 0.05,     // ongoing maintenance
} as const;

// Fixed monthly costs a short-let carries that a long-let does not
// (on a long-let the tenant pays bills).
export const FIXED_BILLS_MONTHLY = 450;
export const FIXED_SOFTWARE_MONTHLY = 42;

// Derived so the bridge always reconciles to the decision:
const TRUE_NET_PCT = 1 - (0.15 + 0.15 + 0.03 + 0.18 + 0.05);                    // = 0.44
const FIXED_COSTS_ANNUAL = (FIXED_BILLS_MONTHLY + FIXED_SOFTWARE_MONTHLY) * 12; // = 5904

export const LL_AGENT_FEE = 0.10;     // standard long-let management-company fee
export const MARGIN_THRESHOLD = 0.50; // uplift required to recommend short-let

export type RecommendationVerdict = 'SHORT_LET' | 'LONG_LET';
export type LongLetSource = 'user' | 'estimate' | 'propertydata_fallback';

export interface Recommendation {
  recommendation: RecommendationVerdict;
  upliftPct: number;
  trueSTRNet: number;
  trueLLNet: number;
  longLetMonthly: number;       // figure actually used
  longLetSource: LongLetSource;
}

export function getRecommendation(grossSTRAnnual: number, longLetMonthly: number) {
  const trueSTRNet = (grossSTRAnnual * TRUE_NET_PCT) - FIXED_COSTS_ANNUAL;
  const trueLLNet = (longLetMonthly * 12) * (1 - LL_AGENT_FEE);
  const upliftPct = (trueSTRNet - trueLLNet) / trueLLNet;
  return {
    recommendation: (upliftPct >= MARGIN_THRESHOLD ? 'SHORT_LET' : 'LONG_LET') as RecommendationVerdict,
    upliftPct,
    trueSTRNet,
    trueLLNet,
  };
}

// TODO: wire to a real long-let lookup. Returns null for now → caller falls
// back to the PropertyData valuation.
export function estimateLongLet(_postcode: string, _bedrooms: number): number | null {
  return null;
}

// Itemised step-down used by the waterfall bridge. The block down to
// `netRevenue` mirrors the full report's headline net; the rest is what the
// decision adds.
export function getCostBreakdown(grossSTRAnnual: number) {
  const platform = grossSTRAnnual * STR_COST_RATES.platform;
  const managementBase = grossSTRAnnual * STR_COST_RATES.managementBase;
  const cleaning = grossSTRAnnual * STR_COST_RATES.cleaning;
  const netRevenue = grossSTRAnnual - platform - managementBase - cleaning;
  const managementVat = grossSTRAnnual * STR_COST_RATES.managementVat;
  const maintenance = grossSTRAnnual * STR_COST_RATES.maintenance;
  const fixed = FIXED_COSTS_ANNUAL;
  const trueTakeHome = netRevenue - managementVat - maintenance - fixed;
  return { gross: grossSTRAnnual, platform, managementBase, cleaning, netRevenue, managementVat, maintenance, fixed, trueTakeHome };
}
