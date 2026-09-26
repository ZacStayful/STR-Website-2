/**
 * Marketplace rows as candidates for the shared ranking (src/lib/listing/rank.ts).
 *
 * The daily picks run ranks listings it found by searching; Today ranks the
 * marketplace pool. Both go through rankForMember, so this module's only job
 * is to hand it the same shape the run does: a listing (for the feedback
 * rules), the deal figures (for fit), the area's fit, the income screening,
 * the short-let pre-check and the motivation read. Plus, for a member whose
 * goals match nothing, which of their filters each row fails, so relax.ts can
 * say which one is costing them the most.
 *
 * The listing built here carries only the public columns. Its canonicalUrl is
 * a stand-in keyed on the deal id, never the real URL: nothing that leaves
 * this module can point at the listing a member pays to open.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { Deal } from '../listing/deal.ts';
import type { DealCard } from '../marketplace/grid.ts';
import type { Precheck } from '../listing/rank.ts';
import { ageFromDates, rentPcm, type RankCandidate, type SourcedListing } from '../listing/sourcing.ts';
import { bandRank, parseScreening, type Screening } from '../listing/screen.ts';
import { meetsMotivationBar, parseMotivation, NO_MOTIVATION } from '../listing/motivation.ts';
import { thresholdDaysFor, type MarketGoals } from '../market/goals.ts';
import type { Dimension, NearMiss } from '../listing/relax.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { AREA_META } from '../market/areas.ts';
import { DEFAULT_FILTERS, filtersToSearch, parseDealFilters, type DealFilters } from '../marketplace/grid.ts';
import { dealFiltersForGoals } from '../onboarding/deal-filters.ts';
import type { AppliedRules } from '../listing/picks.ts';

/** A pool row: the card's columns plus the three ranking reads, all server-side. */
export interface PoolRow extends DealCard {
  deal?: unknown;
  suitability?: unknown;
  screening?: unknown;
}

export type TodayCandidate = RankCandidate & {
  precheck: Precheck;
  screening: Screening | null;
  /** The marketplace deal id: what Today stores and draws. */
  dealId: string;
  /** Annual profit, the tie-break after fit. */
  profit: number | null;
};

/** The stand-in URL a candidate is keyed on. Never the listing's own. */
export const dealKey = (id: string) => `deal:${id}`;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * The stored deal figures (marketplace_deals.deal, deal.ts at house finance
 * defaults), or null when the row carries none or something unrecognisable.
 * Fit reads the target fields, so a deal missing them is no deal at all.
 */
export function parseStoredDeal(raw: unknown): Deal | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.kind === 'purchase' && num(d.grossYieldPct) !== null && num(d.targetYieldPct) !== null) return raw as Deal;
  if (d.kind === 'rent-to-rent' && num(d.monthlyMargin) !== null && num(d.targetMarginPcm) !== null) return raw as Deal;
  return null;
}

/** The public columns as the listing the feedback rules read. */
export function listingFromRow(row: PoolRow): SourcedListing {
  const amount = num(row.price_amount);
  const period = row.price_period === 'pcm' || row.price_period === 'pw' || row.price_period === 'total' ? row.price_period : row.kind === 'rent' ? 'pcm' : 'total';
  return {
    source: row.source,
    id: row.id,
    canonicalUrl: dealKey(row.id),
    kind: row.kind,
    // The type is the nearest the card has to a title; the full listing,
    // read server-side afterwards, replaces it before the final cut.
    title: row.raw_type ?? '',
    address: null,
    postcode: null,
    outcode: row.outcode,
    postcodeArea: row.postcode_area,
    lat: null,
    lng: null,
    bedrooms: row.bedrooms,
    bathrooms: null,
    price: amount !== null && amount > 0 ? { amount, period } : null,
    rawType: row.raw_type,
    photo: null,
    tenure: row.tenure,
    listedDate: row.listed_date,
  };
}

export interface CandidateContext {
  goals: MarketGoals | null;
  /** The member's fit for an area: their personal score with goals, else Stayful's. */
  areaFit: (code: string | null) => number | null;
  areaName: (code: string | null) => string;
  /** The member's price bounds for this row's kind, as the grid applies them. */
  minPrice: number | null;
  maxPrice: number | null;
  now: Date;
}

export interface Built {
  candidate: TodayCandidate;
  /** The member's filters this row misses; empty for a real candidate. */
  fails: Dimension[];
  near: NearMiss;
}

/**
 * One row as a candidate, with what it fails. Null for a row the ranking can
 * never use: no deal figures, or a short-let check worse than "unknown".
 */
export function buildCandidate(row: PoolRow, ctx: CandidateContext): Built | null {
  const deal = parseStoredDeal(row.deal);
  const precheck: Precheck | null = row.suitability === 'ok' ? 'ok' : row.suitability === 'unknown' || row.suitability == null ? 'unknown' : null;
  if (!deal || !precheck) return null;
  const listing = listingFromRow(row);
  const amount = listing.price ? (listing.kind === 'rent' ? rentPcm(listing.price) : listing.price.period === 'total' ? listing.price.amount : null) : null;
  const age = ageFromDates(row.listed_date, row.first_seen_at, ctx.now);

  const fails: Dimension[] = [];
  if (amount !== null && ((ctx.maxPrice !== null && amount > ctx.maxPrice) || (ctx.minPrice !== null && amount < ctx.minPrice))) fails.push('price');

  // Motivation: the pool stores one verdict per listing, read at the house
  // threshold. The member's own "how long is too long" is applied on top, so
  // "motivated sellers only" still means what they set it to. The
  // slower-than-its-area test needs the area's median, which the pool does
  // not carry, so it is skipped — as the picks run skips it when an area's
  // sample is thin.
  const motiv = ctx.goals && ctx.goals.motivation.mode !== 'off' ? ctx.goals.motivation : null;
  const motivation = motiv ? parseMotivation(row.motivation) ?? NO_MOTIVATION : null;
  const longEnough = motiv ? age !== null && age.days >= thresholdDaysFor(motiv, row.kind) : false;
  const qualifies = motiv && motivation ? longEnough && meetsMotivationBar(motivation, { mode: motiv.mode, areaRelative: motiv.areaRelative, areaMedianKnown: false }) : undefined;
  if (motiv?.mode === 'only' && qualifies !== true) fails.push('motivation');

  const candidate: TodayCandidate = {
    listing,
    deal,
    areaFit: ctx.areaFit(row.postcode_area),
    areaName: ctx.areaName(row.postcode_area),
    precheck,
    screening: parseScreening(row.screening),
    motivation,
    motivationQualifies: qualifies,
    dealId: row.id,
    profit: num(row.annual_profit),
  };
  return { candidate, fails, near: { listing, fails, ageDays: age?.days ?? null, amount, bedrooms: row.bedrooms } };
}

/**
 * The final order: the shared ranking's own (listings that clear the
 * short-let check on the card first, then by band, then by fit), with the
 * higher annual profit first among equal fits. Stable, so anything equal on
 * all of those keeps the ranking's order.
 */
export function orderForToday<C extends { fit: number; profit: number | null; precheck: Precheck; screening: Screening | null }>(ranked: readonly C[]): C[] {
  const band = (c: C) => bandRank(c.screening?.band ?? 'qualified');
  return ranked
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.precheck !== 'ok') - Number(b.c.precheck !== 'ok') || band(a.c) - band(b.c) || b.c.fit - a.c.fit || (b.c.profit ?? -Infinity) - (a.c.profit ?? -Infinity) || a.i - b.i)
    .map((x) => x.c);
}

/**
 * The grid filters a member's goals point at, exactly as /deals reads them
 * when the welcome screen sends a member there: Batch 2's mapping, through
 * the grid's own URL round trip. The "N deals match" count uses the same, so
 * the count and the day's cards can never be about different searches. No
 * goals: the whole pool.
 */
export function filtersForGoals(goals: MarketGoals | null, savedAreas: readonly string[]): DealFilters {
  if (!goals) return { ...DEFAULT_FILTERS };
  const search = filtersToSearch(dealFiltersForGoals(goals, savedAreas));
  return parseDealFilters(Object.fromEntries(new URLSearchParams(search)));
}

/**
 * "I want rent-to-rent, not to buy" (and the reverse) changes what is searched
 * for, as it does for the picks run (applyQueryFeedback): the kind switches,
 * and a switched kind drops the other kind's price bounds — a purchase budget
 * is not a rent ceiling.
 */
export function applyKindFeedback(f: DealFilters, rules: Pick<AppliedRules, 'wantKind'>): DealFilters {
  if (!rules.wantKind || rules.wantKind === f.kind) return f;
  const flipped = f.kind !== 'both';
  return { ...f, kind: rules.wantKind, minPrice: flipped ? null : f.minPrice, maxPrice: flipped ? null : f.maxPrice };
}

/** The `n` postcode areas nearest a point, outside the member's own, nearest first. */
export function nearestAreas(from: { lat: number; lng: number } | null, own: ReadonlySet<string>, n: number): string[] {
  if (!from) return [];
  return AREA_META.map((a) => ({ code: a.code, at: areaCentroid(a.code) }))
    .filter((a): a is { code: string; at: { lat: number; lng: number } } => a.at !== null && !own.has(a.code))
    .map((a) => ({ code: a.code, miles: haversineMiles(from, a.at) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.max(0, n))
    .map((a) => a.code);
}

/** Where the member is: their home, else the middle of their chosen areas. Null when neither is known. */
export function referencePoint(goals: MarketGoals | null, areas: readonly string[]): { lat: number; lng: number } | null {
  if (goals?.home && goals.home.lat !== null && goals.home.lng !== null) return { lat: goals.home.lat, lng: goals.home.lng };
  const points = areas.map((a) => areaCentroid(a)).filter((p): p is { lat: number; lng: number } => p !== null);
  if (points.length === 0) return null;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length };
}

/**
 * For a member whose own areas hold nothing: the usable candidate nearest to
 * them, then the better fit. Null when there is no candidate or no idea where
 * they are.
 */
export function nearestOutside<C extends { fit: number; listing: { postcodeArea: string | null } }>(ranked: readonly C[], from: { lat: number; lng: number } | null, own: ReadonlySet<string>): C | null {
  if (!from) return null;
  let best: { c: C; miles: number } | null = null;
  for (const c of ranked) {
    const code = c.listing.postcodeArea;
    if (!code || own.has(code)) continue;
    const at = areaCentroid(code);
    if (!at) continue;
    const miles = haversineMiles(from, at);
    if (!best || miles < best.miles || (miles === best.miles && c.fit > best.c.fit)) best = { c, miles };
  }
  return best?.c ?? null;
}

export const WIDEN_AREA_ADVICE = 'Nothing in your areas today — widening your area would help.';
export const CLOSEST_ADVICE = 'Nothing matched everything you asked for today — this is the closest.';
