/**
 * The Market Explorer's "Buy to let" view (Batch 28, Part H): every
 * district (outcode) the cached key stats hold, by gross yield, 5-year and
 * 1-year growth, average price and the typical cash in a buy-to-let there
 * takes. Free: the region key stats are already bought (the daily warm-up).
 * No yield: "Not enough data", never a guessed figure.
 *
 * Pure: no network, no database, no server-only.
 */
import type { KeyStatsRow } from '../apis/propertydata-parse.ts';
import { postcodeAreaOf } from '../apis/propertydata-parse.ts';
import { countryForPostcode, stampDutyLocal } from '../listing/stamp-duty.ts';
import { DEFAULT_BTL_FINANCE, type BtlFinance } from './config.ts';

export interface BtlDistrictRow {
  outcode: string;
  /** The postcode area ("LS"), for the region and the search. */
  area: string | null;
  grossYieldPct: number | null;
  /** Over five years, and over the last year, %; history, not a forecast. */
  growth5yPct: number | null;
  growth1yPct: number | null;
  avgPrice: number | null;
  /** A 25% deposit, the second-home tax and the buying costs, on the average price. */
  cashIn: number | null;
  /** False when the yield is missing: the row says "Not enough data". */
  enough: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The typical cash in on this price: the deposit, the tax on a second home for its nation, and the buying costs. */
export function typicalCashIn(price: number, outcode: string, buyingCosts: number, f: BtlFinance = DEFAULT_BTL_FINANCE): number {
  const deposit = price * (1 - f.ltvPct / 100);
  return Math.round(deposit + stampDutyLocal(price, countryForPostcode(outcode)).amount + buyingCosts);
}

export function btlDistrictRows(rows: readonly KeyStatsRow[], buyingCosts: number, f: BtlFinance = DEFAULT_BTL_FINANCE): BtlDistrictRow[] {
  const seen = new Set<string>();
  const out: BtlDistrictRow[] = [];
  for (const r of rows) {
    const outcode = (r.outcode ?? '').replace(/\s+/g, '').toUpperCase();
    if (!outcode || seen.has(outcode)) continue;
    seen.add(outcode);
    const yieldPct = r.avgYieldPct !== null && Number.isFinite(r.avgYieldPct) && r.avgYieldPct > 0 ? round1(r.avgYieldPct) : null;
    const price = r.avgPrice !== null && Number.isFinite(r.avgPrice) && r.avgPrice > 0 ? Math.round(r.avgPrice) : null;
    out.push({
      outcode,
      area: postcodeAreaOf(outcode),
      grossYieldPct: yieldPct,
      growth5yPct: r.growth5y !== null && Number.isFinite(r.growth5y) ? round1(r.growth5y) : null,
      growth1yPct: r.growth1y !== null && Number.isFinite(r.growth1y) ? round1(r.growth1y) : null,
      avgPrice: price,
      cashIn: price !== null ? typicalCashIn(price, outcode, buyingCosts, f) : null,
      enough: yieldPct !== null,
    });
  }
  return out;
}

export type BtlDistrictSort = 'yield' | 'growth5y' | 'growth1y' | 'price' | 'cash';

/** Best first on the chosen figure (cheapest first for price and cash in); "Not enough data" last. */
export function sortBtlDistricts(rows: readonly BtlDistrictRow[], by: BtlDistrictSort): BtlDistrictRow[] {
  const value = (r: BtlDistrictRow): number | null => (by === 'yield' ? r.grossYieldPct : by === 'growth5y' ? r.growth5yPct : by === 'growth1y' ? r.growth1yPct : by === 'price' ? r.avgPrice : r.cashIn);
  const asc = by === 'price' || by === 'cash';
  return [...rows].sort((a, b) => {
    if (a.enough !== b.enough) return a.enough ? -1 : 1;
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.outcode < b.outcode ? -1 : 1;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (asc ? va - vb : vb - va) || (a.outcode < b.outcode ? -1 : 1);
  });
}
