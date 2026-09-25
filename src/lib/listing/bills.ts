import { matchAddressEntries, type CouncilTaxBand, type CouncilTaxData } from '../apis/propertydata-parse.ts';

/**
 * The monthly bills line in the deal maths. It used to be a flat £250
 * "utilities, broadband, council tax, insurance"; council tax is now the
 * property's own band from PropertyData and the rest stays as a fixed
 * allowance, so the default total is unchanged when the band is unknown.
 *
 * A property trading as a short let may move from council tax to business
 * rates (often with small business rate relief); the report keeps council
 * tax as the conservative cost and says so on the due diligence page.
 */

/** Energy, water, broadband and the insurance share of the old £250. */
export const UTILITIES_ALLOWANCE_PCM = 120;
/** What the old £250 implied for council tax, so a report with no band still totals £250. */
export const DEFAULT_COUNCIL_TAX_PCM = 130;

export type CouncilTaxMatch = 'address' | 'postcode-mode' | 'default-band-d';

export interface CouncilTaxFigure {
  band: CouncilTaxBand;
  /** Annual charge for the band, GBP (two adults). */
  annual: number;
  council: string | null;
  year: string | null;
  /** How the band was chosen: the address itself, the commonest band in the postcode, or band D. */
  matched: CouncilTaxMatch;
}

export interface BillsSplit {
  billsPcm: number;
  councilTaxPcm: number;
  utilitiesPcm: number;
}

function modalBand(bands: readonly CouncilTaxBand[]): CouncilTaxBand | null {
  const counts = new Map<CouncilTaxBand, number>();
  for (const b of bands) counts.set(b, (counts.get(b) ?? 0) + 1);
  let best: CouncilTaxBand | null = null;
  let bestN = 0;
  for (const [band, n] of counts) {
    // Ties go to the lower band: the cheaper assumption is the safer one to be wrong about.
    if (n > bestN || (n === bestN && best !== null && band < best)) {
      best = band;
      bestN = n;
    }
  }
  return best;
}

/**
 * The band for this address: the address's own row when the postcode list
 * has it (the commonest band among the rows when several flats share the
 * number), else the commonest band in the postcode, else band D. Null only
 * when the council's charges are missing altogether.
 */
export function pickCouncilTaxBand(data: CouncilTaxData | null | undefined, address: string): CouncilTaxFigure | null {
  if (!data) return null;
  const annualFor = (band: CouncilTaxBand): number | null => data.bandsAnnual[band] ?? null;
  const build = (band: CouncilTaxBand, matched: CouncilTaxMatch): CouncilTaxFigure | null => {
    const annual = annualFor(band);
    return annual === null ? null : { band, annual, council: data.council, year: data.year, matched };
  };

  const match = address ? matchAddressEntries(data.properties, address) : null;
  if (match) {
    const band = modalBand(match.entries.map((e) => e.band));
    const figure = band ? build(band, 'address') : null;
    if (figure) return figure;
  }
  const mode = modalBand(data.properties.map((p) => p.band));
  if (mode) {
    const figure = build(mode, 'postcode-mode');
    if (figure) return figure;
  }
  return build('D', 'default-band-d');
}

/** The bills line from the band: council tax per month plus the fixed allowance. */
export function billsFromCouncilTax(ct: CouncilTaxFigure | null | undefined): BillsSplit {
  if (!ct) return { billsPcm: DEFAULT_COUNCIL_TAX_PCM + UTILITIES_ALLOWANCE_PCM, councilTaxPcm: DEFAULT_COUNCIL_TAX_PCM, utilitiesPcm: UTILITIES_ALLOWANCE_PCM };
  const councilTaxPcm = Math.round(ct.annual / 12);
  return { billsPcm: councilTaxPcm + UTILITIES_ALLOWANCE_PCM, councilTaxPcm, utilitiesPcm: UTILITIES_ALLOWANCE_PCM };
}
