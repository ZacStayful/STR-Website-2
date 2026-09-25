import {
  flagPossiblyListed,
  isHighFloodRisk,
  matchAddressEntries,
  outcodeOf,
  type DemandSnapshot,
  type Designation,
  type EpcEntry,
  type FloodRisk,
  type ListedBuilding,
} from '../apis/propertydata-parse.ts';
import type { AnalysisResult, DueDiligence, EpcResult } from '../types.ts';

/**
 * Turns the nine PropertyData answers a report asks for into the EPC and
 * due diligence blocks the report stores. Pure, so the address matching,
 * the listed-building rule and the "nothing came back" case are tested
 * with the documented fixtures; `propertydata-steps.ts` does the asking.
 */

export interface DueDiligenceInputs {
  postcode: string;
  address: string;
  epc: EpcEntry[] | null;
  flood: FloodRisk | null;
  conservationArea: Designation | null;
  greenBelt: Designation | null;
  aonb: Designation | null;
  nationalPark: Designation | null;
  listed: ListedBuilding[] | null;
  demandSale: DemandSnapshot | null;
  demandRent: DemandSnapshot | null;
  fetchedAt: string;
}

/** How many nearby listed buildings the report keeps. */
export const LISTED_NEAREST_KEPT = 3;

/** The address's own certificate: the most recent inspection among the rows that match it. */
export function pickEpc(entries: EpcEntry[] | null | undefined, address: string): EpcResult | null {
  if (!entries || entries.length === 0 || !address) return null;
  const match = matchAddressEntries(entries, address);
  if (!match) return null;
  const latest = [...match.entries].sort((a, b) => (b.inspectionDate ?? '').localeCompare(a.inspectionDate ?? ''))[0];
  return { rating: latest.rating, score: latest.score, inspectionDate: latest.inspectionDate, address: latest.address, matched: match.matched };
}

export function assembleDueDiligence(i: DueDiligenceInputs): { epc: EpcResult | null; dueDiligence: DueDiligence | null } {
  const epc = pickEpc(i.epc, i.address);
  const anything = i.flood || i.conservationArea || i.greenBelt || i.aonb || i.nationalPark || i.listed || i.demandSale || i.demandRent;
  if (!anything) return { epc, dueDiligence: null };
  const dueDiligence: DueDiligence = {
    postcode: i.postcode,
    outcode: outcodeOf(i.postcode),
    floodRisk: i.flood ? { level: i.flood.level, high: isHighFloodRisk(i.flood.level) } : null,
    conservationArea: i.conservationArea,
    greenBelt: i.greenBelt,
    aonb: i.aonb,
    nationalPark: i.nationalPark,
    listedBuildings: i.listed ? { nearest: i.listed.slice(0, LISTED_NEAREST_KEPT), possiblyListed: flagPossiblyListed(i.listed) } : null,
    exitLiquidity: { sale: i.demandSale, rent: i.demandRent },
    fetchedAt: i.fetchedAt,
  };
  return { epc, dueDiligence };
}

/** The caveats the report prints under the register data, on the page and in the PDF. */
export function diligenceNotes(result: Pick<AnalysisResult, 'dueDiligence' | 'councilTax'>): string[] {
  const notes = [
    "EPC, flood risk, designations, listed buildings, council tax and market liquidity are read from the public registers through PropertyData. They are not a substitute for a solicitor's searches or a survey.",
  ];
  if (result.councilTax) {
    notes.push('In England a property available to let for 140 nights a year and actually let for 70 is assessed for business rates instead of council tax, often with small business rate relief. The figures keep council tax as the safer assumption.');
  }
  if (result.dueDiligence?.listedBuildings?.possiblyListed) {
    notes.push('A listed building sits within about 80 metres, so the property itself may be listed: check the title and Historic England before any works.');
  }
  if (result.dueDiligence?.floodRisk?.high) {
    notes.push('The High flood band raises the guest-damage factor in the risk score; insurers may exclude or load flood cover.');
  }
  return notes;
}
