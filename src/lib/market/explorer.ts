/**
 * Server-side Market Explorer card builder. Turns the snapshot from
 * aggregate.ts into the cards the /markets pages render, at every level:
 * regions, areas and districts all carry the same headline (revenue,
 * occupancy, daily rate), direct-booking potential, seasonality and
 * competition, plus a monthly series for the trend charts. Areas also get
 * yield-on-cost, the long-let verdict, licensing, the transparent score
 * and the confidence tier.
 * SERVER ONLY (areas call PropertyData for the long-let comparator).
 */

import { computeYieldOnCost, type YieldOnCost } from './yield.ts';
import { computeAreaVerdict, type AreaVerdict } from './verdict.ts';
import { computeAreaScore, type AreaScore } from './score.ts';
import { areaConfidence, MIN_DISTRICT_SAMPLES, type Confidence } from './confidence.ts';
import { competitionBand, type CompetitionBand } from './competition.ts';
import { areaSeasonality, type Seasonality } from './seasonality.ts';
import { areaDirectBooking, type DirectBooking } from './direct-booking.ts';
import { getAreaLongLetRent } from './area-longlet.ts';
import { getLicensing, type LicensingEntry } from '../data/str-licensing.ts';
import { areaMetaForCode } from './areas.ts';
import { regionForArea, regionForSlug, type RegionMeta } from './regions.ts';
import type { MarketAggregate, MarketArea, MarketBedroomAgg, MarketDistrict, MarketRegion, MarketSnapshot, MonthBucket } from './types.ts';

export { MIN_DISTRICT_SAMPLES };

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

export function areaHeadline(area: MarketAggregate): AreaHeadline {
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
 *  bedroom filter is used (instead of the blended headline). */
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

export function bedroomStats(area: MarketAggregate): BedroomStat[] {
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

/** Competition band for a level, from the reviews of its comparables. */
export function competitionFor(agg: MarketAggregate): CompetitionBand | null {
  const c = agg.competition;
  if (!c) return null;
  return competitionBand({ rating: c.avg_rating, reviews: c.avg_review_count, sampleCount: c.sample_count });
}

/** The figures shared by every level. */
export interface LevelFigures {
  headline: AreaHeadline;
  byBedrooms: BedroomStat[];
  yieldOnCost: YieldOnCost | null;
  confidence: Confidence;
  competition: CompetitionBand | null;
  seasonality: Seasonality | null;
  directBooking: DirectBooking | null;
  /** Rated reports behind the competition band (shown when it is null). */
  ratedReports: number;
  /** Reports carrying a monthly breakdown (shown when seasonality is null). */
  monthlyReports: number;
  series: MonthBucket[];
  /** Short-let listings per km² around the analysed addresses (mean over the comparables), or null. */
  listingDensity: number | null;
  /** Mean age in years of the comparables' listings, or null. */
  listingAge: number | null;
}

function round1(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Math.round(v * 10) / 10;
}

function levelFigures(agg: MarketAggregate): LevelFigures {
  const headline = areaHeadline(agg);
  return {
    headline,
    byBedrooms: bedroomStats(agg),
    yieldOnCost: computeYieldOnCost(agg),
    confidence: areaConfidence(headline.totalSamples),
    competition: competitionFor(agg),
    seasonality: areaSeasonality(agg.seasonality),
    directBooking: areaDirectBooking(agg.demand),
    ratedReports: agg.competition?.sample_count ?? 0,
    monthlyReports: agg.seasonality?.sample_count ?? 0,
    series: agg.series ?? [],
    listingDensity: round1(agg.competition?.avg_listing_density),
    listingAge: round1(agg.competition?.avg_listing_age),
  };
}

export interface DistrictCardData extends LevelFigures {
  code: string; // outward code, e.g. NG7
  areaCode: string;
  /** False until MIN_DISTRICT_SAMPLES reports: the figures are withheld. */
  ready: boolean;
}

export interface RegionCardData extends LevelFigures {
  slug: string;
  name: string;
  areaCodes: string[];
}

export interface AreaCardData extends LevelFigures {
  code: string;
  slug: string;
  name: string;
  region: RegionMeta;
  verdict: AreaVerdict | null;
  licensing: LicensingEntry;
  score: AreaScore | null;
  /** Stayful already manages properties in this postcode area. */
  managedByStayful: boolean;
  districts: DistrictCardData[];
}

export function districtCard(d: MarketDistrict): DistrictCardData {
  const ready = d.total_sample_count >= MIN_DISTRICT_SAMPLES;
  const figures = levelFigures(d);
  if (!ready) {
    figures.headline = { ...figures.headline, grossRevenue: null, adr: null, occupancy: null };
    figures.byBedrooms = [];
    figures.yieldOnCost = null;
    figures.series = [];
    figures.listingDensity = null;
    figures.listingAge = null;
  }
  return { ...figures, code: d.district, areaCode: d.postcode_area, ready };
}

export function regionCard(r: MarketRegion): RegionCardData {
  const meta = regionForSlug(r.slug);
  return { ...levelFigures(r), slug: r.slug, name: meta?.name ?? r.name, areaCodes: r.areas };
}

async function buildAreaCard(area: MarketArea): Promise<AreaCardData> {
  const meta = areaMetaForCode(area.postcode_area);
  const longLetRent = await getAreaLongLetRent(area);
  const figures = levelFigures(area);
  const licensing = getLicensing(area.postcode_area);
  return {
    ...figures,
    code: meta.code,
    slug: meta.slug,
    name: meta.name,
    region: regionForArea(meta.code),
    verdict: computeAreaVerdict(area, longLetRent),
    licensing,
    score: computeAreaScore({
      grossYieldPct: figures.yieldOnCost?.grossYieldPct ?? null,
      occupancyPct: figures.headline.occupancy,
      grossRevenue: figures.headline.grossRevenue,
      licensing: licensing.status,
    }),
    managedByStayful: false, // filled in by the caller from the managed-areas lookup
    districts: (area.districts ?? []).map(districtCard),
  };
}

export interface BuildOptions {
  /** Postcode areas where Stayful manages properties. */
  managedAreas?: ReadonlySet<string>;
}

export interface ExplorerData {
  cards: AreaCardData[];
  regions: RegionCardData[];
  national: MonthBucket[];
  generatedAt: string;
  totalReports: number;
}

/**
 * Every card for the explorer. Areas are sorted by data confidence first
 * (Confirmed areas surface above thin/Early ones), then by score, then yield,
 * so the most trustworthy areas lead while everything stays visible.
 * Uncached: pages go through `cached.ts`, which wraps this in an hourly cache.
 */
export async function buildExplorerData(snapshot: MarketSnapshot, opts: BuildOptions = {}): Promise<ExplorerData> {
  const built = await Promise.all(snapshot.areas.map((a) => buildAreaCard(a).catch(() => null)));
  const cards = built
    .filter((c): c is AreaCardData => c !== null)
    .map((c) => ({ ...c, managedByStayful: opts.managedAreas?.has(c.code) ?? false }))
    .sort(
      (a, b) =>
        b.confidence.rank - a.confidence.rank ||
        (b.score?.score ?? -1) - (a.score?.score ?? -1) ||
        (b.yieldOnCost?.grossYieldPct ?? -1) - (a.yieldOnCost?.grossYieldPct ?? -1),
    );
  return {
    cards,
    regions: snapshot.regions.map(regionCard),
    national: snapshot.national,
    generatedAt: snapshot.generated_at,
    totalReports: snapshot.total_reports,
  };
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
