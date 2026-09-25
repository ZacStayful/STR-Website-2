import 'server-only';

/**
 * PropertyData client (https://api.propertydata.co.uk). The key travels as a
 * query parameter, so it is stripped from every log line and meter key.
 * Every call is metered under provider `propertydata` with the endpoint as
 * the unit (one credit each; the region key stats are thirty). An HTTP
 * error, a `status: 'error'` body or a timeout is logged as a failed call
 * (never charged) and comes back as null so the broker moves on.
 *
 * Nothing here caches or budgets: that is the broker's job, through the
 * questions in `../questions-propertydata.ts`.
 */

import { meter } from '../../credit/meter';
import {
  parseAccountCredits,
  parseCouncilTax,
  parseDemand,
  parseDesignation,
  parseEnergyEfficiency,
  parseFloodRisk,
  parseFloorAreas,
  parseKeyStats,
  parseListedBuildings,
  parseMortgageRates,
  parseStampDuty,
  parseValuationRent,
  parseValuationSale,
  pdCallKey,
  pdErrorMessage,
  pdOk,
  pdUrl,
  type AccountCredits,
  type PdQuery,
} from '../../apis/propertydata-parse';
import type { PdClient, StampDutyQuery } from '../questions-propertydata-defs';

const TIMEOUT_MS = 20_000;

interface PdResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

async function pdGet<T>(path: string, query: PdQuery, unit: string, parse: (json: unknown) => T | null): Promise<T | null> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  if (!apiKey) return null;
  const key = pdCallKey(path, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await meter<PdResponse>(
      // A 200 with `status: 'error'` (bad parameters, no data) is a failed
      // call too: logged, never charged to the member.
      { provider: 'propertydata', unit, key, failed: (res) => !res.ok || !pdOk(res.json) },
      async () => {
        const res = await fetch(pdUrl(path, query, apiKey), { cache: 'no-store', signal: controller.signal });
        const json: unknown = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json };
      },
    );
    if (!r.ok) {
      console.log(`[PropertyData] ${key}: HTTP ${r.status} ${pdErrorMessage(r.json) ?? ''}`.trim());
      return null;
    }
    if (!pdOk(r.json)) {
      console.log(`[PropertyData] ${key}: ${pdErrorMessage(r.json) ?? 'error response'}`);
      return null;
    }
    return parse(r.json);
  } catch (err) {
    console.log(`[PropertyData] ${key}: fetch error:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Today, ISO, for the stamp duty calculator's transaction date. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const pdClient: PdClient = {
  floorAreas: (postcode) => pdGet('floor-areas', { postcode }, 'floor_areas', parseFloorAreas),
  valuationRent: (params) => pdGet('valuation-rent', params, 'valuation_rent', parseValuationRent),
  valuationSale: (params) => pdGet('valuation-sale', params, 'valuation_sale', parseValuationSale),
  stampDuty: (q: StampDutyQuery) =>
    pdGet(
      'stamp-duty-calculator',
      { value: Math.round(q.value), country: q.country, mode: q.mode, uk_resident: q.ukResident === false ? 'false' : 'true', transaction_date: today() },
      'stamp_duty',
      parseStampDuty,
    ),
  mortgageRates: () => pdGet('mortgage-rates', {}, 'mortgage_rates', parseMortgageRates),
  councilTax: (postcode) => pdGet('council-tax', { postcode }, 'council_tax', parseCouncilTax),
  energyEfficiency: (postcode) => pdGet('energy-efficiency', { postcode }, 'energy_efficiency', parseEnergyEfficiency),
  floodRisk: (postcode) => pdGet('flood-risk', { postcode }, 'flood_risk', parseFloodRisk),
  designation: (postcode, field) => pdGet(field.replace(/_/g, '-'), { postcode }, field, (json) => parseDesignation(json, field)),
  listedBuildings: (postcode) => pdGet('listed-buildings', { postcode }, 'listed_buildings', parseListedBuildings),
  demand: (outcode, kind) => pdGet(kind === 'sale' ? 'demand' : 'demand-rent', { postcode: outcode }, kind === 'sale' ? 'demand' : 'demand_rent', (json) => parseDemand(json, kind)),
  keyStats: (region) => pdGet('postcode-key-stats', { region }, 'postcode_key_stats', parseKeyStats),
};

/** Free: the plan's credit position, for the admin panel. */
export function pdAccountCredits(): Promise<AccountCredits | null> {
  return pdGet('account/credits', {}, 'account_credits', parseAccountCredits);
}

export function propertyDataConfigured(): boolean {
  return Boolean(process.env.PROPERTYDATA_API_KEY);
}
