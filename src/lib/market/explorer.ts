/**
 * Server-side Market Explorer aggregator. Assembles the per-area card data the
 * /markets pages render: headline stats, yield-on-cost, long-let vs short-let
 * verdict, and the licensing flag. SERVER ONLY (uses the market client +
 * PropertyData).
 *
 * NOTE (score): the transparent area score (Phase 1 Step 2) is intentionally
 * absent — it is not built until the proposal is signed off. When approved,
 * add it to AreaCardData and the sort here.
 */

import { fetchMarketStats, fetchMarketArea } from './client.ts';
import { computeYieldOnCost, type YieldOnCost } from './yield.ts';
import { computeAreaVerdict, type AreaVerdict } from './verdict.ts';
import { computeAreaScore, type AreaScore } from './score.ts';
import { getAreaLongLetRent } from './area-longlet.ts';
import { getLicensing, type LicensingEntry } from '../data/str-licensing.ts';
import { areaMetaForCode } from './areas.ts';
import type { MarketArea, MarketBedroomAgg } from './types.ts';

function weighted(groups: MarketBedroomAgg[], value: (g: MarketBedroomAgg) => number | null): number | null {
  let sum = 0;
  let n = 0;
  for (const g of groups) {
    const v = value(g);
    if (v === null || g.sample_count <= 0) continue;
    sum += v * g.sample_count;
    n += g.sample_count;
  }
  return n === 0 ? null : sum / n;
}

export interface AreaHeadline {
  grossRevenue: number | null;
  adr: number | null;
  occupancy: number | null; // 0–100
  totalSamples: number;
  bedroomsAvailable: number[];
}

export function areaHeadline(area: MarketArea): AreaHeadline {
  const gross = weighted(area.by_bedrooms, (g) => g.avg_gross_revenue);
  const adr = weighted(area.by_bedrooms, (g) => g.avg_adr);
  const occ = weighted(area.by_bedrooms, (g) => g.avg_occupancy);
  return {
    grossRevenue: gross === null ? null : Math.round(gross),
    adr: adr === null ? null : Math.round(adr),
    occupancy: occ === null ? null : Math.round(occ * 10) / 10,
    totalSamples: area.total_sample_count,
    bedroomsAvailable: area.by_bedrooms.map((g) => g.bedrooms).sort((a, b) => a - b),
  };
}

export interface AreaCardData {
  code: string;
  slug: string;
  name: string;
  headline: AreaHeadline;
  yieldOnCost: YieldOnCost | null;
  verdict: AreaVerdict | null;
  licensing: LicensingEntry;
  score: AreaScore | null;
}

async function buildCard(area: MarketArea): Promise<AreaCardData> {
  const meta = areaMetaForCode(area.postcode_area);
  const longLetRent = await getAreaLongLetRent(area);
  const headline = areaHeadline(area);
  const yieldOnCost = computeYieldOnCost(area);
  const licensing = getLicensing(area.postcode_area);
  return {
    code: meta.code,
    slug: meta.slug,
    name: meta.name,
    headline,
    yieldOnCost,
    verdict: computeAreaVerdict(area, longLetRent),
    licensing,
    score: computeAreaScore({
      grossYieldPct: yieldOnCost?.grossYieldPct ?? null,
      occupancyPct: headline.occupancy,
      grossRevenue: headline.grossRevenue,
      licensing: licensing.status,
    }),
  };
}

/** All area cards for the /markets index, sorted by score desc (nulls last). */
export async function getAreaCards(): Promise<AreaCardData[]> {
  const data = await fetchMarketStats({});
  if (!data) return [];
  const cards = await Promise.all(
    data.areas.map((a) => buildCard(a).catch(() => null)),
  );
  return cards
    .filter((c): c is AreaCardData => c !== null)
    .sort(
      (a, b) =>
        (b.score?.score ?? -1) - (a.score?.score ?? -1) ||
        (b.yieldOnCost?.grossYieldPct ?? -1) - (a.yieldOnCost?.grossYieldPct ?? -1),
    );
}

export interface AreaDetail {
  card: AreaCardData;
  area: MarketArea;
}

/** Full detail for one area page, or null if the area has no qualifying data. */
export async function getAreaDetail(code: string): Promise<AreaDetail | null> {
  const area = await fetchMarketArea(code);
  if (!area) return null;
  const card = await buildCard(area);
  return { card, area };
}

/** Postcode-area codes that currently have qualifying data (for static params). */
export async function listAreaCodes(): Promise<string[]> {
  const data = await fetchMarketStats({});
  if (!data) return [];
  return data.areas.map((a) => a.postcode_area);
}
