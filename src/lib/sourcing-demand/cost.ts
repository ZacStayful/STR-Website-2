/**
 * What a demand-led search costs, against the monthly cap.
 *
 * Before it asks, a search reserves its worst case: a PMI listings credit
 * that comes back empty (paid for all the same) plus the OnTheMarket page
 * the broker then falls back to. Afterwards it is settled to what it really
 * cost: the paid provider calls the meter recorded under the search's own
 * action id, priced from the live unit-cost table. That catches what the
 * broker's own figure misses (a paid but empty PMI answer before the
 * fallback, a retried call), and counts nothing for a cache hit or a failure.
 *
 * Pure: unit costs come in as numbers; no network, no database.
 */

/** Raw pence per unit for a provider:unit, or null when the table has no row. */
export type UnitCostOf = (provider: string, unit: string) => number | null;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** The worst case one search can cost. `pmiFallbackPence` stands in when the table has no PMI row. */
export function reservePence(unitCostOf: UnitCostOf, pmiFallbackPence: number): number {
  const pmi = unitCostOf('pmi', 'listings');
  const page = unitCostOf('onthemarket', 'search_page');
  return round4((pmi ?? pmiFallbackPence) + (page ?? 0));
}

/** One provider_calls row, as far as the cost goes. */
export interface CallRow {
  provider: string;
  unit: string | null;
  quantity: number | null;
  ok: boolean | null;
  cache_hit: boolean | null;
}

/** Raw pence for the calls one search made: paid calls only, priced from the live table. */
export function actualPence(rows: readonly CallRow[], unitCostOf: UnitCostOf): number {
  let sum = 0;
  for (const r of rows) {
    if (r.ok !== true || r.cache_hit === true || !r.unit) continue;
    const unit = unitCostOf(r.provider, r.unit);
    if (unit === null || !Number.isFinite(unit) || unit <= 0) continue;
    const q = typeof r.quantity === 'number' && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : 1;
    sum += unit * q;
  }
  return round4(sum);
}

/** This run's cap: an override (a test run) may only lower the setting, never raise it. */
export function effectiveCap(settingPence: number, overridePence: number | null | undefined): number {
  if (overridePence === null || overridePence === undefined || !Number.isFinite(overridePence) || overridePence < 0) return settingPence;
  return Math.min(settingPence, Math.floor(overridePence));
}
