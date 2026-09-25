/**
 * From a sourced listing to a marketplace deal record: the screening, the
 * quick deal, the suitability and motivation reads, and the handful of
 * columns the grid filters and sorts on.
 *
 * `screenSourced` is the block the daily picks run used to do inline (and now
 * calls): one implementation, so the marketplace and the picks can never
 * disagree about whether a property clears the bar. Rent and revenue come from
 * the same helpers the screening report uses, for the same reason.
 *
 * Pure: no network, no database. The rent table and area figures are supplied
 * by the caller.
 */
import { areaRevenueFor, dealForSourced, rentPcm, type AreaFigures, type SourcedListing, type SourcingKind } from '../listing/sourcing.ts';
import { screen, marketRentFor, grossRevenueFor, type Screening, type Band } from '../listing/screen.ts';
import { suitabilityFromListing, type Suitability } from '../listing/suitability.ts';
import { motivationFromListing, type Motivation, type MotivationContext } from '../listing/motivation.ts';
import { DEFAULT_GOALS, thresholdDaysFor } from '../market/goals.ts';
import { statusFromText } from '../listing/parsers/shared.ts';
import type { Deal } from '../listing/deal.ts';
import type { ListingSnapshot, ListingStatus } from '../listing/types.ts';

/** The stored-rent lookup, keyed exactly as broker/providers/internal.ts keys it. */
export function areaRentKey(postcodeArea: string, bedrooms: number): string {
  return `${postcodeArea.trim().toUpperCase()}|${Math.round(bedrooms)}`;
}

export interface StoredRent {
  monthlyRent: number;
  samples: number;
}

/** The few area-card fields the record needs; structurally matches AreaCardData. */
export interface AreaCardLike {
  code: string;
  name: string;
  slug: string;
  byBedrooms: { bedrooms: number; grossRevenue: number | null; adr: number | null }[];
  headline: { grossRevenue: number | null; adr: number | null };
  score?: { score: number } | null;
}

export function figuresFor(card: AreaCardLike | null): AreaFigures | null {
  if (!card) return null;
  return { byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } };
}

/**
 * The income screening for a sourced listing against its area's figures and
 * the stored rent for its size. Lifted verbatim from the picks run.
 */
export function screenSourced(l: SourcedListing, card: AreaCardLike | null, rentTable: ReadonlyMap<string, StoredRent>): { screening: Screening; figures: AreaFigures | null } {
  const figures = figuresFor(card);
  const rev = figures ? areaRevenueFor(figures, l.bedrooms) : null;
  const exactBeds = l.bedrooms !== null && (card?.byBedrooms.some((b) => b.bedrooms === l.bedrooms && b.grossRevenue) ?? false);
  const rent = marketRentFor({
    kind: l.kind,
    bedrooms: l.bedrooms,
    advertisedRentPcm: l.kind === 'rent' ? rentPcm(l.price) : null,
    storedRent: l.postcodeArea && l.bedrooms !== null ? (rentTable.get(areaRentKey(l.postcodeArea, l.bedrooms)) ?? null) : null,
  });
  const screening = screen(l.kind, {
    bedrooms: l.bedrooms,
    grossRevenue: grossRevenueFor(rev?.grossRevenue ?? null, exactBeds),
    marketRent: rent?.figure ?? null,
  });
  return { screening, figures };
}

export interface DealRecord {
  screening: Screening;
  band: Band;
  deal: Deal | null;
  suitability: Suitability;
  motivation: Motivation;
  /** screening.surplus: the annual surplus over a long let, or the R2R annual profit. The ladder and sort key. */
  annualProfit: number | null;
  /** Purchase only. */
  upliftPct: number | null;
  town: string | null;
  /** Sale: the asking price. Rent: normalised to pcm. */
  priceAmount: number | null;
  pricePeriod: 'total' | 'pcm' | null;
}

export interface BuildOptions {
  card: AreaCardLike | null;
  rentTable: ReadonlyMap<string, StoredRent>;
  firstSeenAt: string | null;
  cohort?: MotivationContext['cohort'];
  areaMedianDays?: number | null;
  now?: Date;
}

export function buildDealRecord(l: SourcedListing, opts: BuildOptions): DealRecord {
  const { screening, figures } = screenSourced(l, opts.card, opts.rentTable);
  const motivation = motivationFromListing(l, {
    thresholdDays: thresholdDaysFor(DEFAULT_GOALS.motivation, l.kind),
    areaMedianDays: opts.areaMedianDays ?? null,
    firstSeenAt: opts.firstSeenAt,
    cohort: opts.cohort ?? null,
    now: opts.now,
  });
  const price = normalisedPrice(l);
  return {
    screening,
    band: screening.band,
    deal: dealForSourced(l, figures, null),
    suitability: suitabilityFromListing(l),
    motivation,
    annualProfit: screening.surplus,
    upliftPct: screening.kind === 'purchase' ? screening.upliftPct : null,
    town: townFrom(l.address, l.title),
    priceAmount: price?.amount ?? null,
    pricePeriod: price?.period ?? null,
  };
}

export function normalisedPrice(l: SourcedListing): { amount: number; period: 'total' | 'pcm' } | null {
  if (!l.price) return null;
  if (l.kind === 'rent') {
    const pcm = rentPcm(l.price);
    return pcm ? { amount: pcm, period: 'pcm' } : null;
  }
  return l.price.period === 'total' ? { amount: l.price.amount, period: 'total' } : null;
}

/**
 * Whether a record belongs on the marketplace: qualified, and not something
 * a short let can never be run in. `unknown` suitability is allowed in — the
 * entry fetch reads the page and retires it if the page says otherwise.
 */
export function qualifiesForMarketplace(rec: Pick<DealRecord, 'band' | 'suitability'>): boolean {
  return rec.band === 'qualified' && (rec.suitability === 'ok' || rec.suitability === 'unknown');
}

/** A status the feed itself states in the listing's tags / features, if any. */
export function feedStatusOf(l: SourcedListing): ListingStatus | null {
  const text = [l.priceQualifier ?? null, l.addedOrReduced ?? null, ...(l.features ?? [])].filter(Boolean).join(' | ');
  return statusFromText(text);
}

const POSTCODE_LIKE = /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i;

/**
 * The town from a portal address: the last comma-separated part that is not
 * a postcode or outcode. "12 High Street, Fulford, York, YO10" → "York".
 */
export function townFrom(address: string | null | undefined, fallback?: string | null): string | null {
  const parts = (address ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !POSTCODE_LIKE.test(p) && !/^\d+$/.test(p));
  if (parts.length > 0) return parts[parts.length - 1];
  if (fallback) return townFrom(fallback);
  return null;
}

/** The merged listing after a page read: what the page knows beats the search card. Lifted verbatim from the picks run. */
export function mergeSnapshotIntoListing(l: SourcedListing, s: ListingSnapshot): SourcedListing {
  return {
    ...l,
    title: s.title || l.title,
    address: s.displayAddress ?? l.address,
    postcode: s.postcode ?? l.postcode,
    bedrooms: s.bedrooms ?? l.bedrooms,
    bathrooms: s.bathrooms ?? l.bathrooms,
    price: s.price && s.price.period !== 'night' ? { amount: s.price.amount, period: s.price.period } : l.price,
    rawType: s.rawType ?? l.rawType,
    photo: s.photos[0] ?? l.photo,
    tenure: s.tenure ?? l.tenure ?? null,
    features: s.features.length > 0 ? s.features : (l.features ?? []),
    priceQualifier: s.price?.qualifier ?? l.priceQualifier ?? null,
    sharedOwnership: s.sharedOwnership ?? false,
    shortLetsPermitted: s.shortLetsPermitted ?? null,
    listedDate: s.listedDate ?? l.listedDate ?? null,
    agentHash: s.agentHash ?? l.agentHash ?? null,
  };
}

/**
 * A ListingSnapshot for the pipeline (checked_listings.snapshot is read as one
 * everywhere). The live page's snapshot when there is one; otherwise the
 * minimum the pipeline needs, built from the sourced listing, for a Zoopla
 * deal that was never fetched.
 */
export function snapshotFromDeal(l: SourcedListing, live: ListingSnapshot | null, now: Date = new Date()): ListingSnapshot {
  if (live) return live;
  return {
    source: l.source,
    id: l.id,
    canonicalUrl: l.canonicalUrl,
    fetchedAt: now.toISOString(),
    parserVersion: 0,
    kind: l.kind,
    title: l.title,
    displayAddress: l.address ?? undefined,
    postcode: l.postcode ?? undefined,
    outcode: l.outcode ?? undefined,
    lat: l.lat ?? undefined,
    lng: l.lng ?? undefined,
    bedrooms: l.bedrooms ?? undefined,
    bathrooms: l.bathrooms ?? undefined,
    rawType: l.rawType ?? undefined,
    price: l.price ? { amount: l.price.amount, period: l.price.period, qualifier: l.priceQualifier ?? undefined } : undefined,
    status: 'available',
    tenure: l.tenure ?? undefined,
    sharedOwnership: l.sharedOwnership ?? undefined,
    shortLetsPermitted: l.shortLetsPermitted ?? null,
    features: l.features ?? [],
    photos: l.photo ? [l.photo] : [],
    listedDate: l.listedDate ?? undefined,
    agentHash: l.agentHash ?? null,
    locationConfidence: l.lat !== null && l.lng !== null ? 'exact' : l.outcode ? 'outcode' : 'none',
  };
}

export type { SourcingKind };
