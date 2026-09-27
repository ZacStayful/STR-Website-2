/**
 * What an action will cost, in base pence, before it runs. `max` is the sum of
 * every unit the action can hit (what gets reserved); `typical` is what a
 * normal run costs. Both use the live unit-cost table so an admin edit changes
 * the quote without a deploy.
 */

import type { UnitCostTable } from './costs.ts';
import { priceFor, round4 } from './pricing.ts';

export type CreditAction = 'report' | 'report_enhanced' | 'quick_view' | 'narrate' | 'speak' | 'autocomplete' | 'geocode';

/** The standard report is Airbtics + PropertyData; enhanced adds the PMI second opinion. */
export function reportAction(enhanced: boolean): CreditAction {
  return enhanced ? 'report_enhanced' : 'report';
}

export interface EstimateLine {
  provider: string;
  unit: string;
  quantity: number;
  basePence: number;
  /** Only in the worst case (fallback branches, retries). */
  worstCaseOnly?: boolean;
}

export interface Estimate {
  action: CreditAction;
  typicalBasePence: number;
  maxBasePence: number;
  lines: EstimateLine[];
}

export interface ReportEstimateOptions {
  pmiSecondOpinion?: boolean;
  priceLabs?: boolean;
  /** Narration characters, for `speak`. */
  characters?: number;
  /** Prompt / completion token ceilings, for `narrate`. */
  inputTokens?: number;
  maxOutputTokens?: number;
  /** Price at this multiplier instead of each row's own (funnel leads: 2). */
  markupOverride?: number;
}

/**
 * The PropertyData calls every full report makes beyond the valuations:
 * one credit each, all at postcode or outcode level and cached for weeks,
 * so the reservation is the worst case of a postcode nobody has run before.
 * Mortgage rates and region key stats are bought by the cron, not here.
 */
export const PD_REPORT_UNITS = ['stamp_duty', 'council_tax', 'energy_efficiency', 'flood_risk', 'conservation_area', 'listed_buildings', 'green_belt', 'aonb', 'national_park', 'demand', 'demand_rent'] as const;

function line(table: UnitCostTable, provider: string, unit: string, quantity: number, worstCaseOnly = false, markupOverride?: number): EstimateLine {
  return { provider, unit, quantity, basePence: priceFor(table, provider, unit, quantity, markupOverride).basePence, worstCaseOnly };
}

export function estimateAction(table: UnitCostTable, action: CreditAction, opts: ReportEstimateOptions = {}): Estimate {
  const mk = opts.markupOverride;
  let lines: EstimateLine[] = [];
  switch (action) {
    case 'report':
    case 'report_enhanced':
      lines = [
        line(table, 'google', 'geocode', 1, false, mk),
        line(table, 'propertydata', 'floor_areas', 1, false, mk),
        line(table, 'propertydata', 'valuation_rent', 1, false, mk),
        line(table, 'propertydata', 'valuation_rent', 2, true, mk),
        line(table, 'propertydata', 'valuation_sale', 1, false, mk),
        line(table, 'propertydata', 'valuation_sale', 1, true, mk),
        ...PD_REPORT_UNITS.map((u) => line(table, 'propertydata', u, 1, false, mk)),
        line(table, 'airbtics', 'report_all', 1, false, mk),
        line(table, 'airbtics', 'bounds', 1, false, mk),
        line(table, 'airbtics', 'market_search', 1, true, mk),
        line(table, 'airbtics', 'market_summary', 1, true, mk),
        line(table, 'airbtics', 'metric_revenue', 1, true, mk),
        line(table, 'airbtics', 'metric_occupancy', 1, true, mk),
        line(table, 'airbtics', 'bounds', 1, true, mk),
        line(table, 'google', 'places_nearby', 6, false, mk),
        line(table, 'ticketmaster', 'event_search', 1, false, mk),
        ...((opts.pmiSecondOpinion ?? action === 'report_enhanced') ? [line(table, 'pmi', 'str_estimate', 1, false, mk)] : []),
        ...(opts.priceLabs ? [line(table, 'pricelabs', 'revenue_estimate', 1, false, mk)] : []),
      ];
      break;
    case 'quick_view':
      lines = [line(table, 'google', 'reverse_geocode', 1, false, mk), line(table, 'onthemarket', 'listing_page', 1, false, mk), line(table, 'airbtics', 'bounds', 1, false, mk), line(table, 'pmi', 'str_market', 1, true, mk), line(table, 'airbtics', 'bounds', 1, true, mk)];
      break;
    case 'narrate':
      lines = [line(table, 'anthropic', 'input_token', opts.inputTokens ?? 900, false, mk), line(table, 'anthropic', 'output_token', opts.maxOutputTokens ?? 600, false, mk)];
      break;
    case 'speak':
      lines = [line(table, 'elevenlabs', 'character', opts.characters ?? 800, false, mk)];
      break;
    case 'autocomplete':
      lines = [line(table, 'google', 'autocomplete_session', 1, false, mk)];
      break;
    case 'geocode':
      lines = [line(table, 'google', 'geocode', 1, false, mk)];
      break;
  }
  const typical = round4(lines.filter((l) => !l.worstCaseOnly).reduce((s, l) => s + l.basePence, 0));
  const max = round4(lines.reduce((s, l) => s + l.basePence, 0));
  return { action, typicalBasePence: typical, maxBasePence: max, lines };
}

/**
 * The most one full analysis can cost US, in RAW pence, with every fallback
 * and retry firing in the same run: all six long-let and five sale valuation
 * attempts, the Airbtics markets fallback, and ten bounds calls (the markets
 * fallback can make eight on top of the two the estimate reserves). No
 * markup: this is what the fixed full-analysis price must always stay above,
 * so the margin can never go negative however unlucky a report is. Checked
 * by the tests against the seeded price, and by /admin/billing before a new
 * price is saved.
 */
export function fullAnalysisRawCeiling(table: UnitCostTable, opts: { pmi?: boolean; priceLabs?: boolean } = {}): number {
  const raw = (provider: string, unit: string, quantity: number) => priceFor(table, provider, unit, quantity).rawPence;
  let total =
    raw('google', 'geocode', 1) +
    raw('propertydata', 'floor_areas', 1) +
    raw('propertydata', 'valuation_rent', 6) +
    raw('propertydata', 'valuation_sale', 5) +
    PD_REPORT_UNITS.reduce((s, u) => s + raw('propertydata', u, 1), 0) +
    raw('airbtics', 'report_all', 1) +
    raw('airbtics', 'bounds', 10) +
    raw('airbtics', 'market_search', 1) +
    raw('airbtics', 'market_summary', 1) +
    raw('airbtics', 'metric_revenue', 1) +
    raw('airbtics', 'metric_occupancy', 1) +
    raw('google', 'places_nearby', 6) +
    raw('ticketmaster', 'event_search', 1);
  if (opts.pmi) total += raw('pmi', 'str_estimate', 1);
  if (opts.priceLabs) total += raw('pricelabs', 'revenue_estimate', 1);
  return round4(total);
}
