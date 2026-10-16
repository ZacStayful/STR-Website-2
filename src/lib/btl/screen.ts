/**
 * Screening one sale listing for buy-to-let, and what the nightly job does
 * with its pool row (Batch 28, Part A). The job (screen-server.ts) loads the
 * inputs and writes the answers; everything that decides is here.
 *
 *   THE LENS      btlSuitability (a lender's rules) → the rent range (district
 *                 + comparables, a paid valuation folded in when there is one)
 *                 → btlDeal at the live rate and the nation's tax → growth →
 *                 the stored card. It passes when the hard rules pass.
 *   THE ROW       One marketplace_deals row per listing carries both lenses:
 *                 band = 'qualified' is still the short-let deal, btl_pass the
 *                 buy-to-let one. A listing with no row that passes only as
 *                 buy-to-let is let in; a row retired for a short-let-only
 *                 reason that passes is brought back; a row that is ONLY a
 *                 buy-to-let deal and stops passing is retired. A short-let or
 *                 BRRR row is never retired here.
 *   THE SHORTLIST A rent valuation is bought only where it could change the
 *                 answer: a deal whose middle passes but whose low end does not,
 *                 then a passing deal on a rough rent, nearest to members who
 *                 chose buy-to-let first, within the day's count and cap.
 *
 * Pure: no network, no database, no server-only.
 */

import type { SourcedListing } from '../listing/sourcing.ts';
import type { KeyStatsRow } from '../apis/propertydata-parse.ts';
import { countryForPostcode } from '../listing/stamp-duty.ts';
import { weeklyToMonthly } from '../market/key-stats.ts';
import type { RetiredReason } from '../marketplace/types.ts';
import type { BenchmarkDeal } from './benchmark.ts';
import { buildBtlCard, type BtlCard } from './card.ts';
import type { BtlSettings } from './config.ts';
import { btlDeal, cashBandFor, type EpcRating } from './deal.ts';
import { growthRange } from './growth.ts';
import { btlSuitability, flatCharges, listingKind, shortLeaseFlag, type BtlSuitability } from './listing.ts';
import { narrowWithValuation, rentRangeFor, type RentComp, type RentRange } from './rent.ts';

export interface DistrictStats {
  row: KeyStatsRow;
  /** PropertyData region (north_west, …). */
  region: string;
  asOf: string | null;
}

export interface Valuation {
  monthly: number;
  low?: number | null;
  high?: number | null;
}

export interface BtlScreenContext {
  settings: BtlSettings;
  /** Batch 17's buying costs (project_costs.buyingCosts). */
  buyingCosts: number;
  ratePct: number | null;
  rateDate: string | null;
  district(outcode: string | null): DistrictStats | null;
  /** Live rentals by postcode area. */
  rentals(postcodeArea: string | null): readonly RentComp[];
  epc(url: string): EpcRating | null;
  valuation(url: string): Valuation | null;
  now: Date;
}

export interface BtlScreen {
  url: string;
  suitability: BtlSuitability;
  rent: RentRange | null;
  card: BtlCard | null;
  /** The hard rules pass on a suitable home. */
  pass: boolean;
  /** For the benchmark (null when there is no figure). */
  benchmark: BenchmarkDeal | null;
}

const LONDON_REGION = 'greater_london';

export function screenForBtl(l: SourcedListing, ctx: BtlScreenContext): BtlScreen {
  const url = l.canonicalUrl;
  const none = (suitability: BtlSuitability, rent: RentRange | null = null): BtlScreen => ({ url, suitability, rent, card: null, pass: false, benchmark: null });
  if (l.kind !== 'sale') return none('room');
  const s = ctx.settings;
  const suitability = btlSuitability(l, s.listing);
  if (suitability !== 'ok') return none(suitability);
  const price = l.price && l.price.period === 'total' ? l.price.amount : null;
  const bedrooms = l.bedrooms;
  if (price === null || !(price > 0) || bedrooms === null || bedrooms < 0) return none('ok');
  const outcode = (l.outcode ?? '').toUpperCase() || null;
  const district = ctx.district(outcode);
  const weekly = district?.row.avgRentWeekly ?? null;
  const kind = listingKind(l);
  const area = (l.postcodeArea ?? '').toUpperCase() || null;
  let rent = rentRangeFor(
    { bedrooms, kind, postcodeArea: area, lat: l.lat, lng: l.lng, districtRentPcm: weekly !== null && weekly > 0 ? weeklyToMonthly(weekly) : null, districtYieldPct: district?.row.avgYieldPct ?? null },
    ctx.rentals(area),
    s.rent,
  );
  if (!rent) return none('ok');
  const valuation = ctx.valuation(url);
  if (valuation) rent = narrowWithValuation(rent, valuation, s.rent);
  const country = countryForPostcode(l.postcode ?? l.outcode);
  const flat = flatCharges(kind, { serviceChargeYear: l.serviceChargeAnnual ?? null, groundRentYear: l.groundRentAnnual ?? null }, district?.region === LONDON_REGION, s.flats);
  const epc = ctx.epc(url);
  const deal = btlDeal(price, rent, { ratePct: ctx.ratePct, country, buyingCosts: ctx.buyingCosts, flat, epc, finance: s.finance, costs: s.costs, epcSettings: s.epc });
  if (!deal) return none('ok', rent);
  const growth = growthRange(price, district?.row.growth5y ?? null, district?.row.growth1y ?? null, outcode ?? '', district?.asOf ?? null);
  const band = cashBandFor(deal.cashIn.mid, s.bands);
  const card = buildBtlCard({
    computedAt: ctx.now.toISOString(),
    bedrooms,
    kind,
    country,
    outcode,
    region: district?.region ?? null,
    rent,
    deal,
    growth,
    rateDate: ctx.rateDate,
    band,
    serviceChargeConfirmed: flat ? flat.confirmed : null,
    epc,
    shortLease: shortLeaseFlag(l, s.listing),
  });
  return {
    url,
    suitability,
    rent,
    card,
    pass: card.floorsOk,
    benchmark: band ? { band, lat: l.lat, lng: l.lng, region: district?.region ?? null, roiMidPct: deal.roiPct.mid, growthMidPct: growth?.annualPct.mid ?? null } : null,
  };
}

// ─── Rentals as comparables ────────────────────────────────────────────

/** A stored rental, as read for the comparables (only the fields the rule needs). */
export interface RentalRow {
  postcode_area: string | null;
  price: unknown;
  bedrooms: unknown;
  lat: unknown;
  lng: unknown;
  raw_type: string | null;
  title: string | null;
}

/** Rooms, shares, student and holiday lets, parking and park homes are never a whole-home long let. */
const NOT_A_WHOLE_HOME = /house ?share|flat ?share|room to rent|rooms? (?:available|in a)|en-?suite room|lodger|bedsit|student|multiple occupation|\bhmo\b|garage|parking|private hall|hotel|holiday|short[- ]?term|serviced|mobile home|park home|caravan|retirement|over ?55/i;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** One rental listing as a comparable, or null when it is not a whole home let by the month. */
export function rentCompFrom(r: RentalRow): RentComp | null {
  const price = r.price && typeof r.price === 'object' ? (r.price as { amount?: unknown; period?: unknown }) : null;
  if (!price || price.period !== 'pcm') return null;
  const pcm = num(price.amount);
  const bedrooms = num(r.bedrooms);
  if (pcm === null || bedrooms === null || bedrooms < 0) return null;
  if (NOT_A_WHOLE_HOME.test(`${r.raw_type ?? ''} | ${r.title ?? ''}`)) return null;
  return { pcm, bedrooms, kind: listingKind({ rawType: r.raw_type, title: r.title ?? '' }), postcodeArea: r.postcode_area ? r.postcode_area.toUpperCase() : null, lat: num(r.lat), lng: num(r.lng) };
}

// ─── The pool row ──────────────────────────────────────────────────────

/** Retirements that only ever concerned the short-let (or BRRR) lens: a row that passes as buy-to-let comes back. */
export const BTL_REVIVE_REASONS: ReadonlySet<RetiredReason> = new Set<RetiredReason>(['unqualified', 'insufficient_data', 'unsuitable', 'unverifiable', 'unchecked', 'not_project', 'project_excluded', 'project_no_evidence', 'project_uncheckable']);

/**
 * The same reasons, as retireDeal meets them on a row that is still a
 * buy-to-let deal: the short-let lens failed, the buy-to-let one has not.
 * 'unchecked' is left out there (a short-let shortlist expiring says nothing
 * about the deal); the nightly screen brings such a row back instead.
 */
export const BTL_KEEP_REASONS: ReadonlySet<RetiredReason> = new Set<RetiredReason>([...BTL_REVIVE_REASONS].filter((r) => r !== 'unchecked'));

export interface PoolRowFacts {
  status: 'pending_check' | 'pending_verify' | 'live' | 'retired';
  band: string;
  /** Carries a Project (BRRR) card. */
  project: boolean;
  retiredReason: RetiredReason | null;
}

/** A row that is a buy-to-let deal and nothing else. */
export function btlOnlyRow(row: Pick<PoolRowFacts, 'band' | 'project'>): boolean {
  return row.band !== 'qualified' && !row.project;
}

export type BtlRowAction = 'write' | 'insert' | 'revive' | 'retire' | 'skip';

/**
 * What the nightly job does with a listing's row. `shortLetQualifies` is the
 * short-let record's verdict (a listing that would qualify as a short let is
 * left to the short-let intake and its checks); `feedGone` the feed saying it
 * has sold or gone.
 */
export function btlRowAction(row: PoolRowFacts | null, pass: boolean, shortLetQualifies: boolean, feedGone: boolean): BtlRowAction {
  if (!row) return pass && !shortLetQualifies && !feedGone ? 'insert' : 'skip';
  if (row.status === 'retired') return pass && !feedGone && row.retiredReason !== null && BTL_REVIVE_REASONS.has(row.retiredReason) ? 'revive' : 'skip';
  if (!pass && btlOnlyRow(row)) return 'retire';
  return 'write';
}

/** The short-let band a buy-to-let-only row carries: never 'qualified', which means a short-let deal. */
export function btlOnlyBand(band: string): string {
  return band === 'qualified' ? 'unqualified' : band;
}

// ─── The paid shortlist ────────────────────────────────────────────────

export interface ShortlistCandidate {
  url: string;
  postcode: string | null;
  postcodeArea: string | null;
  card: BtlCard;
  /** A valuation is already folded in (or cached): nothing to buy. */
  valued: boolean;
}

/**
 * The listings worth a paid rent valuation today, best first: those whose
 * answer it could flip (the middle passes the lender test, the low end goes
 * negative), then passing deals resting on a rough rent. Areas members chose
 * buy-to-let in come first within each; a full postcode is needed.
 */
export function pickShortlist(candidates: readonly ShortlistCandidate[], wantedAreas: ReadonlySet<string>, limit: number): ShortlistCandidate[] {
  if (limit <= 0) return [];
  const fullPostcode = (p: string | null) => Boolean(p && /\s?\d[A-Z]{2}$/i.test(p.trim()));
  const tier = (c: ShortlistCandidate): number | null => {
    if (c.valued || !fullPostcode(c.postcode)) return null;
    const borderline = c.card.rentTest.pass && c.card.cashflowMonthly.low < 0 && c.card.cashflowMonthly.mid >= 0;
    if (borderline) return 0;
    if (c.card.floorsOk && c.card.rent.confidence === 'low') return 1;
    return null;
  };
  return candidates
    .map((c) => ({ c, t: tier(c), wanted: wantedAreas.has((c.postcodeArea ?? '').toUpperCase()) ? 0 : 1 }))
    .filter((x): x is { c: ShortlistCandidate; t: number; wanted: number } => x.t !== null)
    .sort((a, b) => a.t - b.t || a.wanted - b.wanted || Math.abs(a.c.card.cashflowMonthly.low) - Math.abs(b.c.card.cashflowMonthly.low) || a.c.url.localeCompare(b.c.url))
    .slice(0, limit)
    .map((x) => x.c);
}

/** PropertyData's property type for a rent valuation, from the listing's own wording. */
export function valuationPropertyType(rawType: string | null | undefined, kind: 'flat' | 'house' | 'unknown'): string {
  const t = (rawType ?? '').toLowerCase();
  if (kind === 'flat') return 'flat';
  if (/semi/.test(t)) return 'semi-detached_house';
  if (/detached|bungalow/.test(t)) return 'detached_house';
  if (/terrace|town ?house|mews|cottage/.test(t)) return 'terraced_house';
  return kind === 'house' ? 'terraced_house' : 'flat';
}
