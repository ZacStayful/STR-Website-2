import 'server-only';

import { ask, pdAonb, pdConservationArea, pdDemandRent, pdDemandSale, pdEnergyEfficiency, pdFloodRisk, pdFloorAreas, pdGreenBelt, pdListedBuildings, pdLongLetRent, pdNationalPark, pdSaleValuation } from '../broker';
import type { BrokerContext } from '../broker/types';
import {
  fallbackLongLet,
  floorAreaFromEntry,
  longLetFromValuation,
  matchAddressEntry,
  outcodeOf,
  type FloorAreaResult,
  type RentValuationOptions,
} from '../apis/propertydata-parse';
import type { DueDiligence, EpcResult, LongLetData, PropertyDataValuation } from '../types';
import { assembleDueDiligence } from './due-diligence';

/**
 * The three PropertyData steps of an analysis, each asked through the
 * broker so a postcode already seen is a cache hit and the daily budget
 * holds. None of them throws: the fallbacks are the same the old direct
 * client used, so a PropertyData outage degrades the report exactly as
 * before rather than failing it.
 */

/** Floor area for the address, or the bedroom default when the postcode's list has no match. */
export async function floorAreaFor(postcode: string, address: string, bedrooms: number, ctx: BrokerContext): Promise<FloorAreaResult> {
  const r = await ask(pdFloorAreas, { postcode }, ctx);
  const match = r.value ? matchAddressEntry(r.value, address) : null;
  const area = floorAreaFromEntry(match?.entry, bedrooms);
  if (area.matched) console.log(`[PropertyData] floor area ${area.squareFeet} sq ft (${match?.matched} match${r.cached ? ', cached' : ''})`);
  else console.log(`[PropertyData] floor area: ${r.value ? 'no address match' : 'unavailable'}, using the bedroom default`);
  return area;
}

/** Long-let rent estimate, or the national median when PropertyData cannot value the postcode. */
export async function longLetFor(postcode: string, bedrooms: number, options: RentValuationOptions, ctx: BrokerContext): Promise<LongLetData> {
  const r = await ask(pdLongLetRent, { postcode, bedrooms, options }, ctx);
  if (r.value) {
    console.log(`[PropertyData] long-let £${r.value.monthlyRent}/month (attempt ${r.value.attempt}${r.cached ? ', cached' : ''})`);
    return longLetFromValuation(r.value);
  }
  console.log('[PropertyData] long-let valuation unavailable, using the national median');
  return fallbackLongLet(bedrooms);
}

/**
 * EPC, flood risk, the four planning designations, listed buildings and the
 * outcode's sales and rental liquidity: nine one-credit questions, all
 * cached by postcode or outcode, asked in parallel. `ask` never throws, so
 * a missing answer is simply null in the assembled block.
 */
export async function dueDiligenceFor(postcode: string, address: string, ctx: BrokerContext): Promise<{ epc: EpcResult | null; dueDiligence: DueDiligence | null }> {
  const outcode = outcodeOf(postcode);
  const p = { postcode };
  const [epc, flood, conservationArea, greenBelt, aonb, nationalPark, listed, demandSale, demandRent] = await Promise.all([
    ask(pdEnergyEfficiency, p, ctx),
    ask(pdFloodRisk, p, ctx),
    ask(pdConservationArea, p, ctx),
    ask(pdGreenBelt, p, ctx),
    ask(pdAonb, p, ctx),
    ask(pdNationalPark, p, ctx),
    ask(pdListedBuildings, p, ctx),
    outcode ? ask(pdDemandSale, { outcode }, ctx) : Promise.resolve(null),
    outcode ? ask(pdDemandRent, { outcode }, ctx) : Promise.resolve(null),
  ]);
  const out = assembleDueDiligence({
    postcode,
    address,
    epc: epc.value,
    flood: flood.value,
    conservationArea: conservationArea.value,
    greenBelt: greenBelt.value,
    aonb: aonb.value,
    nationalPark: nationalPark.value,
    listed: listed.value,
    demandSale: demandSale?.value ?? null,
    demandRent: demandRent?.value ?? null,
    fetchedAt: new Date().toISOString(),
  });
  console.log(`[PropertyData] due diligence: EPC ${out.epc ? out.epc.rating : 'none'}, flood ${out.dueDiligence?.floodRisk?.level ?? 'n/a'}, listed nearby ${out.dueDiligence?.listedBuildings?.nearest.length ?? 0}`);
  return out;
}

/** Sale valuation with PropertyData's own margin; null when it cannot value the postcode. */
export async function saleValuationFor(postcode: string, bedrooms: number, propertyType: string, ctx: BrokerContext): Promise<PropertyDataValuation | null> {
  const r = await ask(pdSaleValuation, { postcode, bedrooms, propertyType }, ctx);
  const v = r.value;
  if (!v) {
    console.log('[PropertyData] sale valuation unavailable');
    return null;
  }
  console.log(`[PropertyData] sale valuation £${v.estimate} (£${v.low}–£${v.high}${v.confidence ? `, ${v.confidence} confidence` : ''}${r.cached ? ', cached' : ''})`);
  return { estimatedValue: v.estimate, valuationRangeLow: v.low, valuationRangeHigh: v.high, margin: v.margin, confidence: v.confidence, source: 'propertydata' };
}
