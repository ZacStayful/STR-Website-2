/**
 * What an action will cost, in base pence, before it runs. `max` is the sum of
 * every unit the action can hit (what gets reserved); `typical` is what a
 * normal run costs. Both use the live unit-cost table so an admin edit changes
 * the quote without a deploy.
 */

import type { UnitCostTable } from './costs.ts';
import { priceFor, round4 } from './pricing.ts';

export type CreditAction = 'report' | 'quick_view' | 'narrate' | 'speak' | 'autocomplete' | 'geocode';

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
}

function line(table: UnitCostTable, provider: string, unit: string, quantity: number, worstCaseOnly = false): EstimateLine {
  return { provider, unit, quantity, basePence: priceFor(table, provider, unit, quantity).basePence, worstCaseOnly };
}

export function estimateAction(table: UnitCostTable, action: CreditAction, opts: ReportEstimateOptions = {}): Estimate {
  let lines: EstimateLine[] = [];
  switch (action) {
    case 'report':
      lines = [
        line(table, 'google', 'geocode', 1),
        line(table, 'propertydata', 'floor_areas', 1),
        line(table, 'propertydata', 'valuation_rent', 1),
        line(table, 'propertydata', 'valuation_rent', 2, true),
        line(table, 'propertydata', 'valuation_sale', 1),
        line(table, 'propertydata', 'valuation_sale', 1, true),
        line(table, 'airbtics', 'report_all', 1),
        line(table, 'airbtics', 'bounds', 1),
        line(table, 'airbtics', 'market_search', 1, true),
        line(table, 'airbtics', 'market_summary', 1, true),
        line(table, 'airbtics', 'metric_revenue', 1, true),
        line(table, 'airbtics', 'metric_occupancy', 1, true),
        line(table, 'airbtics', 'bounds', 1, true),
        line(table, 'google', 'places_nearby', 6),
        line(table, 'ticketmaster', 'event_search', 1),
        ...(opts.pmiSecondOpinion === false ? [] : [line(table, 'pmi', 'str_estimate', 1)]),
        ...(opts.priceLabs ? [line(table, 'pricelabs', 'revenue_estimate', 1)] : []),
      ];
      break;
    case 'quick_view':
      lines = [line(table, 'google', 'reverse_geocode', 1), line(table, 'onthemarket', 'listing_page', 1), line(table, 'airbtics', 'bounds', 1), line(table, 'pmi', 'str_market', 1, true), line(table, 'airbtics', 'bounds', 1, true)];
      break;
    case 'narrate':
      lines = [line(table, 'anthropic', 'input_token', opts.inputTokens ?? 900), line(table, 'anthropic', 'output_token', opts.maxOutputTokens ?? 600)];
      break;
    case 'speak':
      lines = [line(table, 'elevenlabs', 'character', opts.characters ?? 800)];
      break;
    case 'autocomplete':
      lines = [line(table, 'google', 'autocomplete_session', 1)];
      break;
    case 'geocode':
      lines = [line(table, 'google', 'geocode', 1)];
      break;
  }
  const typical = round4(lines.filter((l) => !l.worstCaseOnly).reduce((s, l) => s + l.basePence, 0));
  const max = round4(lines.reduce((s, l) => s + l.basePence, 0));
  return { action, typicalBasePence: typical, maxBasePence: max, lines };
}
