/**
 * Server-side Market Explorer aggregator. Assembles the per-area card data the
 * /markets pages render: headline stats, yield-on-cost, long-let vs short-let
 * verdict, licensing flag, transparent score and confidence tier.
 * SERVER ONLY (uses the market client + PropertyData).
 */

import { fetchMarketStats } from './client.ts';
import { computeYieldOnCost, type YieldOnCost } from './yield.ts';
import { computeAreaVerdict, type AreaVerdict } from './verdict.ts';
import { computeAreaScore, type AreaScore } from './score.ts';
import { areaConfidence, type Confidence } from './confidence.ts';
import { rankCompetition, type CompetitionRank } from './competition.ts';
import { areaDirectBooking, type DirectBooking } from './direct-booking.ts';
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

/** Per-bedroom stats so the client can show bedroom-specific figures when the
 *  bedroom filter is used (instead of the area-blended headline). */
export interface BedroomStat {
  bedrooms: number;
  samples: number;
  adr: number | null;
  occupancy: number | null; // 0–100
  grossRevenue: number | null;
  propertyValueLow: number | null;
  propertyValueHigh: number | null;
  propertyValueMid: number | null;
  grossYieldPct: number | null;
}

export function bedroomStats(area: MarketArea): BedroomStat[] {
  return area.by_bedrooms
    .map((g) => {
      const mid =
        g.avg_property_value_low !== null && g.avg_property_value_high !== null
          ? (g.avg_property_value_low + g.avg_property_value_high) / 2
          : null;
      const grossYieldPct =
        mid !== null && mid > 0 && g.avg_gross_revenue !== null
          ? Math.round((g.avg_gross_revenue / mid) * 1000) / 10
          : null;
      return {
        bedrooms: g.bedrooms,
        samples: g.sample_count,
        adr: g.avg_adr === null ? null : Math.round(g.avg_adr),
        occupancy: g.avg_occupancy === null ? null : Math.round(g.avg_occupancy * 10) / 10,
        grossRevenue: g.avg_gross_revenue === null ? null : Math.round(g.avg_gross_revenue),
        propertyValueLow: g.avg_property_value_low === null ? null : Math.round(g.avg_property_value_low),
        propertyValueHigh: g.avg_property_value_high === null ? null : Math.round(g.avg_property_value_high),
        propertyValueMid: mid === null ? null : Math.round(mid),
        grossYieldPct,
      };
    })
    .sort((a, b) => a.bedrooms - b.bedrooms);
}

export interface AreaCardData {
  code: string;
  slug: string;
  name: string;
  headline: AreaHeadline;
  byBedrooms: BedroomStat[];
  yieldOnCost: YieldOnCost | null;
  verdict: AreaVerdict | null;
  licensing: LicensingEntry;
  score: AreaScore | null;
  confidence: Confidence;
  /** Relative competition rank (Phase 2); null until enough areas carry signals. */
  competition: CompetitionRank | null;
  directBooking: DirectBooking | null;
  /** Stayful already manages properties in this postcode area. */
  managedByStayful: boolean;
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
    byBedrooms: bedroomStats(area),
    yieldOnCost,
    verdict: computeAreaVerdict(area, longLetRent),
    licensing,
    score: computeAreaScore({
      grossYieldPct: yieldOnCost?.grossYieldPct ?? null,
      occupancyPct: headline.occupancy,
      grossRevenue: headline.grossRevenue,
      licensing: licensing.status,
    }),
    confidence: areaConfidence(headline.totalSamples),
    competition: null, // filled in once every area is known (relative rank)
    directBooking: areaDirectBooking(area.demand),
    managedByStayful: false, // filled in by the caller from the managed-areas lookup
  };
}

/** Attach the relative competition rank; needs every area at once. */
export function withCompetition(cards: AreaCardData[], areas: MarketArea[]): AreaCardData[] {
  const byCode = new Map(areas.map((a) => [a.postcode_area.toUpperCase(), a]));
  const ranks = rankCompetition(
    cards.map((c) => {
      const comp = byCode.get(c.code)?.competition ?? null;
      return {
        code: c.code,
        density: comp?.avg_listing_density ?? null,
        reviews: comp?.avg_review_count ?? null,
        age: comp?.avg_listing_age ?? null,
        sampleCount: comp?.sample_count ?? 0,
      };
    }),
  );
  return cards.map((c) => ({ ...c, competition: ranks.get(c.code) ?? null }));
}

export interface BuildOptions {
  /** Postcode areas where Stayful manages properties. */
  managedAreas?: ReadonlySet<string>;
}

/**
 * All area cards for the /markets index. Sorted by data confidence first
 * (Confirmed areas surface above thin/Early ones), then by score, then yield —
 * so the most trustworthy areas lead while everything stays visible.
 * Uncached: pages go through `cached.ts`, which wraps this in an hourly cache.
 */
export async function buildAreaCards(opts: BuildOptions = {}): Promise<AreaCardData[]> {
  const data = await fetchMarketStats({});
  if (!data) return [];
  const built = await Promise.all(
    data.areas.map((a) => buildCard(a).catch(() => null)),
  );
  const cards = withCompetition(
    built.filter((c): c is AreaCardData => c !== null),
    data.areas,
  ).map((c) => ({ ...c, managedByStayful: opts.managedAreas?.has(c.code) ?? false }));
  return cards
    .sort(
      (a, b) =>
        b.confidence.rank - a.confidence.rank ||
        (b.score?.score ?? -1) - (a.score?.score ?? -1) ||
        (b.yieldOnCost?.grossYieldPct ?? -1) - (a.yieldOnCost?.grossYieldPct ?? -1),
    );
}

export interface SampleArea {
  card: AreaCardData;
  totalAreas: number;
  totalSamples: number;
}

/**
 * One area shown with real figures on the public product page, as a taster
 * for logged-out visitors. Picks MARKET_SAMPLE_AREA when it has data, else
 * the best-backed area (the cards are already sorted confidence → score).
 * Returns null when no data is available so the page can omit the section.
 */
export function pickSampleArea(cards: AreaCardData[], wanted = process.env.MARKET_SAMPLE_AREA): SampleArea | null {
  if (cards.length === 0) return null;
  const code = wanted?.trim().toUpperCase();
  const card = (code && cards.find((c) => c.code === code)) || cards[0];
  return {
    card,
    totalAreas: cards.length,
    totalSamples: cards.reduce((n, c) => n + c.headline.totalSamples, 0),
  };
}
