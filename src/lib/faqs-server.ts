import 'server-only';

import { getPlans } from './credit/plans';
import { getBillingSettings } from './credit/unit-costs';
import { DEFAULT_COST_FIGURES, type CostFigures } from './faqs-data';

/**
 * The live figures for the FAQ's "What does it cost?": what Pricing.tsx
 * reads, so the two cannot disagree. Falls back to the seeded defaults for
 * any figure the settings do not carry.
 */
export async function costFiguresNow(): Promise<CostFigures> {
  const [settings, plans] = await Promise.all([getBillingSettings(), getPlans().catch(() => [])]);
  const monthly = plans.filter((p) => p.active && p.interval === 'month').map((p) => p.pricePence).filter((p) => p > 0);
  const presets = settings.topupPresetsPence.filter((p) => p > 0);
  return {
    welcomePence: settings.welcomeGrantPence,
    fullAnalysisPence: settings.dealPricing.fullAnalysisPence,
    pmiAddonPence: settings.dealPricing.pmiAddonPence,
    minPlanPence: monthly.length > 0 ? Math.min(...monthly) : DEFAULT_COST_FIGURES.minPlanPence,
    minTopupPence: presets.length > 0 ? Math.min(...presets) : DEFAULT_COST_FIGURES.minTopupPence,
    topupRate: settings.spendRates.topup,
  };
}
