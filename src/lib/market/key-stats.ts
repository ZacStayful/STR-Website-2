import { AREA_REGION } from './regions.ts';
import { postcodeAreaOf, type KeyStatsRow } from '../apis/propertydata-parse.ts';
import type { OutcodeGrowth } from '../types.ts';

/**
 * PropertyData's region key stats: one 30-credit call per region returns
 * every outcode's average price, £/sqft, weekly rent, gross yield, 1/3/5/7
 * year price growth, sales a month and turnover. Eleven regions cover the
 * UK, so a monthly refresh (bought by the market-warm cron, a few regions
 * a day) is about 330 credits, and every report and explorer card reads
 * the cached rows for free.
 *
 * Pure: the region mapping, per-outcode lookup, area aggregation and the
 * cron's warm-up planner are all tested with fakes.
 */

export const PD_REGIONS = [
  'north_east',
  'north_west',
  'east_midlands',
  'west_midlands',
  'east_of_england',
  'greater_london',
  'south_east',
  'south_west',
  'wales',
  'scotland',
  'northern_ireland',
] as const;

export type PdRegion = (typeof PD_REGIONS)[number];

/**
 * Explorer region slug → PropertyData region. PropertyData documents eleven
 * regions and Yorkshire & the Humber is not one of them; its outcodes are
 * provisionally read from `north_east` until the preview shows which region
 * carries LS, S and BD. Change it here and nowhere else.
 */
export const REGION_SLUG_TO_PD: Record<string, PdRegion | null> = {
  'north-east': 'north_east',
  'north-west': 'north_west',
  'yorkshire-humber': 'north_east',
  'east-midlands': 'east_midlands',
  'west-midlands': 'west_midlands',
  'east-of-england': 'east_of_england',
  'greater-london': 'greater_london',
  'south-east': 'south_east',
  'south-west': 'south_west',
  wales: 'wales',
  scotland: 'scotland',
  'northern-ireland': 'northern_ireland',
  other: null,
};

export function isPdRegion(v: unknown): v is PdRegion {
  return typeof v === 'string' && (PD_REGIONS as readonly string[]).includes(v);
}

/** The PropertyData region a postcode area's stats live in, or null for Crown dependencies and unknown areas. */
export function pdRegionForArea(areaCode: string | null | undefined): PdRegion | null {
  const slug = AREA_REGION[(areaCode ?? '').trim().toUpperCase()];
  return slug ? (REGION_SLUG_TO_PD[slug] ?? null) : null;
}

export function pdRegionForOutcode(outcode: string | null | undefined): PdRegion | null {
  return pdRegionForArea(postcodeAreaOf(outcode));
}

export function keyStatsForOutcode(rows: readonly KeyStatsRow[] | null | undefined, outcode: string): KeyStatsRow | null {
  const code = outcode.replace(/\s+/g, '').toUpperCase();
  return rows?.find((r) => r.outcode === code) ?? null;
}

export function weeklyToMonthly(weekly: number): number {
  return Math.round((weekly * 52) / 12);
}

/** Figures for an area or district, aggregated from its outcodes' rows. */
export interface AreaKeyStats {
  avgPrice: number | null;
  avgRentPcm: number | null;
  avgYieldPct: number | null;
  growth1y: number | null;
  growth3y: number | null;
  growth5y: number | null;
  growth7y: number | null;
  salesPerMonth: number | null;
  /** How many outcodes contributed. */
  outcodes: number;
}

/**
 * Mean of a metric across rows, weighted by sales a month when every
 * contributing row has one (a busy outcode says more about the area than a
 * quiet one), else a plain mean. Rows without the metric are left out.
 */
function weightedMean(rows: readonly KeyStatsRow[], pick: (r: KeyStatsRow) => number | null, dp: number): number | null {
  const pairs = rows.map((r) => ({ v: pick(r), w: r.salesPerMonth })).filter((p): p is { v: number; w: number | null } => p.v !== null && Number.isFinite(p.v));
  if (pairs.length === 0) return null;
  const weighted = pairs.every((p) => p.w !== null && p.w > 0);
  const total = weighted ? pairs.reduce((s, p) => s + (p.w as number), 0) : pairs.length;
  const sum = pairs.reduce((s, p) => s + p.v * (weighted ? (p.w as number) : 1), 0);
  const f = 10 ** dp;
  return Math.round((sum / total) * f) / f;
}

export function aggregateKeyStats(rows: readonly KeyStatsRow[]): AreaKeyStats | null {
  if (rows.length === 0) return null;
  const rentWeekly = weightedMean(rows, (r) => r.avgRentWeekly, 1);
  const stats: AreaKeyStats = {
    avgPrice: weightedMean(rows, (r) => r.avgPrice, 0),
    avgRentPcm: rentWeekly === null ? null : weeklyToMonthly(rentWeekly),
    avgYieldPct: weightedMean(rows, (r) => r.avgYieldPct, 1),
    growth1y: weightedMean(rows, (r) => r.growth1y, 1),
    growth3y: weightedMean(rows, (r) => r.growth3y, 1),
    growth5y: weightedMean(rows, (r) => r.growth5y, 1),
    growth7y: weightedMean(rows, (r) => r.growth7y, 1),
    salesPerMonth: rows.reduce<number | null>((s, r) => (r.salesPerMonth === null ? s : (s ?? 0) + r.salesPerMonth), null),
    outcodes: rows.length,
  };
  const any = [stats.avgPrice, stats.avgRentPcm, stats.avgYieldPct, stats.growth1y, stats.growth3y, stats.growth5y, stats.growth7y].some((v) => v !== null);
  return any ? stats : null;
}

/** The rows for one postcode area ("BN" → BN1, BN10, …), aggregated. */
export function areaKeyStats(rows: readonly KeyStatsRow[] | null | undefined, areaCode: string): AreaKeyStats | null {
  if (!rows) return null;
  const code = areaCode.trim().toUpperCase();
  return aggregateKeyStats(rows.filter((r) => postcodeAreaOf(r.outcode) === code));
}

/** One outcode's row as the report stores it. */
export function outcodeGrowth(row: KeyStatsRow, region: string, asOf: string | null): OutcodeGrowth {
  return {
    outcode: row.outcode,
    region,
    avgPrice: row.avgPrice,
    avgYieldPct: row.avgYieldPct,
    growth1y: row.growth1y,
    growth3y: row.growth3y,
    growth5y: row.growth5y,
    growth7y: row.growth7y,
    salesPerMonth: row.salesPerMonth,
    turnoverPct: row.turnoverPct,
    asOf,
  };
}

// ─── The cron's warm-up ──────────────────────────────────────────

export interface KeyStatsRead {
  value: KeyStatsRow[] | null;
  cached: boolean;
  stale: boolean;
  unavailable: boolean;
  updatedAt: string | null;
}

/** Reads a region: 'cache' never spends; 'buy' may. */
export type KeyStatsReader = (region: PdRegion, mode: 'cache' | 'buy') => Promise<KeyStatsRead>;

export interface WarmResult {
  /** Bought this run. */
  warmed: PdRegion[];
  /** Still within their month. */
  fresh: PdRegion[];
  /** Wanted buying but the run's allowance was spent; next run's job. */
  deferred: PdRegion[];
  /** Bought nothing back (budget, outage, no key). */
  failed: PdRegion[];
}

/** How many regions one run may buy: 4 × 30 credits, so a full cycle takes three days and one bad day cannot spend the month. */
export const WARM_REGIONS_PER_RUN = 4;

/**
 * Buys the regions whose cached stats are missing or past their month, at
 * most `max` per run, in a fixed order so a deferred region is first next
 * time. Cheap when everything is fresh: eleven cache reads, no spend.
 */
export async function warmRegionKeyStats(read: KeyStatsReader, max = WARM_REGIONS_PER_RUN): Promise<WarmResult> {
  const out: WarmResult = { warmed: [], fresh: [], deferred: [], failed: [] };
  for (const region of PD_REGIONS) {
    const cached = await read(region, 'cache');
    if (cached.value && !cached.stale) {
      out.fresh.push(region);
      continue;
    }
    if (out.warmed.length >= max) {
      out.deferred.push(region);
      continue;
    }
    const bought = await read(region, 'buy');
    if (bought.value && !bought.cached) out.warmed.push(region);
    else if (bought.value && !bought.stale) out.fresh.push(region);
    // The broker handed back the stale rows because it could not buy
    // (budget spent, provider down): that is a failed refresh, not a fresh one.
    else out.failed.push(region);
  }
  return out;
}
