/**
 * Today's buy-to-let slots (Batch 28, Parts C and E): the member's
 * buy-to-let deals, judged on what they are after and the cash they can put
 * in, and found nearest first.
 *
 *   THE DEALS     pool rows that pass the hard rules (btl_pass) with a
 *                 stored card, in budget (the middle cash in no more than
 *                 the top of their band), that pass their priority against
 *                 the benchmark for their band where they search (rules.ts
 *                 passesFor). Never a short-let figure: only the card.
 *   WIDENING      their own areas first. Short of a full day there, the
 *                 nearest areas outward, a step at a time (10, 25, 50 miles,
 *                 then their region, then the whole UK; btl_benchmark's
 *                 steps), never another deal type. Each deal remembers the
 *                 step it was found at, so the day can say how far it looked
 *                 for what it shows ("so I looked up to 25 miles out").
 *   THE ORDER     own areas, then each step in turn; inside one, the best
 *                 margin over the benchmark on their priority first.
 *
 * Pure: no network, no database, no server-only.
 */
import { AREA_META, areaMetaForCode } from '../market/areas.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { regionForArea } from '../market/regions.ts';
import type { MarketGoals } from '../market/goals.ts';
import type { DealFilters } from '../marketplace/grid.ts';
import { feedbackRules, type PickFeedback } from '../listing/picks.ts';
import { referencePoint, type PoolRow } from '../today/candidates.ts';
import { filtersForType } from '../today/type-filters.ts';
import { TODAY_SIZE } from '../today/day.ts';
import type { Benchmark } from './benchmark.ts';
import { judgedOf, type BtlCard } from './card.ts';
import { DEFAULT_BTL_SETTINGS, type BtlSettings } from './config.ts';
import { inBudget, type CashBand } from './deal.ts';
import { passesFor, type BtlPriority } from './rules.ts';

/** What a member's buy-to-let deals are judged on when they have not said (decided: a bit of both). */
export const DEFAULT_BTL_PRIORITY: BtlPriority = 'both';

/** Rows read per step: the pool's best for these areas. */
export const BTL_POOL_LIMIT = 400;

/** How far out a deal was found: their own areas, a circle, their region, or anywhere in the UK. */
export type BtlFoundAt = { scope: 'own' } | { scope: 'miles'; miles: number } | { scope: 'region'; region: string } | { scope: 'national' };

/** The day's "I looked further" line, stored with the list (choice.btlWiden) and said in Today and the email. */
export interface BtlWiden {
  /** Where they search: "Leeds". */
  from: string;
  found: Exclude<BtlFoundAt, { scope: 'own' }>;
}

export interface BtlReads {
  /** The pool narrowed to Buy to let (types ['btl']), as Today reads it for this member. */
  pool: (filters: DealFilters, limit: number) => Promise<PoolRow[]>;
  /** The stored benchmark for this area and band (btl_benchmarks); null when there is none. */
  benchmark: (area: string, band: CashBand) => Promise<Benchmark | null>;
}

export interface BtlChooseInput {
  goals: MarketGoals | null;
  savedAreas: readonly string[];
  feedback: PickFeedback[];
  exclude: ReadonlySet<string>;
  settings?: BtlSettings;
}

export interface BtlPick {
  dealId: string;
  card: BtlCard;
  found: BtlFoundAt;
  /** Miles from where they search to the deal's area, when both are known. */
  miles: number | null;
  /** How far over the benchmark on their priority (percentage points); the margin over nothing when there is no benchmark. */
  margin: number;
}

export interface BtlDayChoice {
  dealIds: string[];
  picks: BtlPick[];
  /** Their own areas' passing deals ("N deals match you"); null when they search everywhere. */
  ownMatches: number | null;
  /** 0–100, how strong the best one is, on the scale Today's mix compares types by. */
  best: number | null;
  /** Where they search, named; null when it is not known. */
  from: string | null;
}

/** The area a member's benchmark is read for: their home's, else the one of theirs nearest the middle of them, else the nearest to the middle. */
export function centreAreaOf(goals: MarketGoals | null, areas: readonly string[]): string | null {
  const home = goals?.home?.postcode ?? null;
  if (home) {
    const m = /^([A-Z]{1,2})\d/.exec(home.replace(/\s+/g, '').toUpperCase());
    if (m && areaCentroid(m[1])) return m[1];
  }
  const centre = referencePoint(goals, areas);
  const candidates = areas.length > 0 ? areas : AREA_META.map((a) => a.code);
  if (!centre) return areas[0] ?? null;
  let best: { code: string; miles: number } | null = null;
  for (const code of candidates) {
    const at = areaCentroid(code);
    if (!at) continue;
    const miles = haversineMiles(centre, at);
    if (!best || miles < best.miles) best = { code, miles };
  }
  return best?.code ?? null;
}

/** How far over the benchmark the deal is on what the member is after: what orders the day. */
export function btlMargin(priority: BtlPriority, card: BtlCard, bm: Benchmark | null): number {
  const roi = card.roiPct.mid;
  const growth = card.growth?.annualPct.mid ?? null;
  const usable = bm && !bm.none ? bm : null;
  if (priority === 'income') return roi - (usable?.roiMedianPct ?? 0);
  if (priority === 'growth') return growth === null ? Number.NEGATIVE_INFINITY : growth - (usable?.growthMedianPct ?? 0);
  // A bit of both: the weaker of the two decides.
  return Math.min(roi - (usable?.roiP40Pct ?? 0), growth === null ? Number.NEGATIVE_INFINITY : growth - (usable?.growthP40Pct ?? 0));
}

/** The strength Today's mix compares types by (0–100): a pass is a good match, more so the further over it is. */
export function btlStrength(margin: number): number {
  return Math.round(60 + Math.max(0, Math.min(40, margin * 5)));
}

/** The member's answer, or the default. */
export function btlPriorityOf(goals: MarketGoals | null): BtlPriority {
  return goals?.btl?.priority ?? DEFAULT_BTL_PRIORITY;
}

const roundMiles = (m: number) => Math.round(m);

/** "the North West", "Wales", "Yorkshire & the Humber": a region as a sentence says it. */
export function regionPhrase(name: string): string {
  return /^(Wales|Scotland|Northern Ireland|Greater London|Yorkshire)/.test(name) ? name : `the ${name}`;
}

/**
 * The areas each widening step adds, nearest first: within 10, 25 and 50
 * miles, then the rest of their region, then everywhere else. Each step
 * holds only areas no earlier step had.
 */
export function widenSteps(centreArea: string | null, own: readonly string[], stepsMiles: readonly number[]): { found: Exclude<BtlFoundAt, { scope: 'own' }>; areas: string[] }[] {
  const centre = centreArea ? areaCentroid(centreArea) : null;
  const seen = new Set(own);
  const out: { found: Exclude<BtlFoundAt, { scope: 'own' }>; areas: string[] }[] = [];
  const all = AREA_META.map((a) => ({ code: a.code, at: areaCentroid(a.code) }));
  if (centre) {
    for (const miles of [...stepsMiles].sort((a, b) => a - b)) {
      const areas = all.filter((a) => a.at && !seen.has(a.code) && haversineMiles(centre, a.at) <= miles).map((a) => a.code);
      areas.forEach((a) => seen.add(a));
      if (areas.length > 0) out.push({ found: { scope: 'miles', miles }, areas });
    }
    const region = regionForArea(centreArea);
    if (region.slug !== 'other') {
      const areas = all.filter((a) => !seen.has(a.code) && regionForArea(a.code).slug === region.slug).map((a) => a.code);
      areas.forEach((a) => seen.add(a));
      if (areas.length > 0) out.push({ found: { scope: 'region', region: regionPhrase(region.name) }, areas });
    }
  }
  const rest = all.filter((a) => !seen.has(a.code)).map((a) => a.code);
  if (rest.length > 0) out.push({ found: { scope: 'national' }, areas: rest });
  return out;
}

/**
 * The member's buy-to-let deals for today, best first: their own areas,
 * then outward until there are enough for a full day or nowhere is left.
 */
export async function chooseBtlDay(input: BtlChooseInput, reads: BtlReads): Promise<BtlDayChoice> {
  const s = input.settings ?? DEFAULT_BTL_SETTINGS;
  const goals = input.goals;
  const priority = btlPriorityOf(goals);
  const band = goals?.btl?.cashBand ?? null;
  const filters = filtersForType(goals, input.savedAreas, 'btl');
  const own = filters.areas;
  const centreArea = centreAreaOf(goals, own);
  const centre = centreArea ? areaCentroid(centreArea) : null;
  const from = own.length === 1 ? areaMetaForCode(own[0]).name : centreArea ? areaMetaForCode(centreArea).name : null;
  const rules = feedbackRules(input.feedback);

  const benchmarks = new Map<CashBand, Promise<Benchmark | null>>();
  const benchmarkFor = (b: CashBand | null): Promise<Benchmark | null> => {
    if (!b || !centreArea) return Promise.resolve(null);
    if (!benchmarks.has(b)) benchmarks.set(b, reads.benchmark(centreArea, b).catch(() => null));
    return benchmarks.get(b)!;
  };

  const seen = new Set<string>();
  const judge = async (rows: readonly PoolRow[], found: BtlFoundAt): Promise<BtlPick[]> => {
    const out: BtlPick[] = [];
    for (const row of rows) {
      if (seen.has(row.id) || input.exclude.has(row.id)) continue;
      seen.add(row.id);
      if (row.kind !== 'sale' || row.btl_pass !== true) continue;
      if (row.postcode_area && rules.badAreas.has(row.postcode_area.toUpperCase())) continue;
      const card = row.btl ?? null;
      if (!card || !card.floorsOk) continue;
      if (band && !inBudget(card.cashIn.mid, band, s.bands)) continue;
      // The benchmark for their band (or the deal's own band when they have not said).
      const bm = await benchmarkFor(band ?? card.band);
      if (!passesFor(priority, judgedOf(card), bm).pass) continue;
      const at = row.postcode_area ? areaCentroid(row.postcode_area.toUpperCase()) : null;
      out.push({ dealId: row.id, card, found, miles: centre && at ? roundMiles(haversineMiles(centre, at)) : null, margin: btlMargin(priority, card, bm) });
    }
    return out.sort((a, b) => b.margin - a.margin || b.card.cashflowMonthly.low - a.card.cashflowMonthly.low || (a.miles ?? 0) - (b.miles ?? 0) || (a.dealId < b.dealId ? -1 : 1));
  };

  const base: DealFilters = { ...filters, minPrice: null, maxPrice: null, minProfit: null, minUplift: null };
  const picks = await judge(await reads.pool(base, BTL_POOL_LIMIT), { scope: 'own' });
  const ownMatches = own.length > 0 ? picks.length : null;
  if (own.length > 0 && picks.length < TODAY_SIZE) {
    for (const step of widenSteps(centreArea, own, s.benchmark.stepsMiles)) {
      if (step.found.scope === 'region' && !s.benchmark.region) continue;
      if (step.found.scope === 'national' && !s.benchmark.national) continue;
      picks.push(...(await judge(await reads.pool({ ...base, areas: step.areas }, BTL_POOL_LIMIT), step.found)));
      if (picks.length >= TODAY_SIZE) break;
    }
  }
  return { dealIds: picks.map((p) => p.dealId), picks, ownMatches, best: picks.length > 0 ? btlStrength(picks[0].margin) : null, from };
}

const FOUND_ORDER = (f: BtlFoundAt): number => (f.scope === 'own' ? 0 : f.scope === 'miles' ? f.miles : f.scope === 'region' ? 1e6 : 2e6);

/**
 * The line for the day, from the buy-to-let deals it shows: how far it
 * looked for the furthest of them. Null when every one is in their own
 * areas (or none is shown).
 */
export function btlWidenFor(choice: Pick<BtlDayChoice, 'picks' | 'from'>, shown: readonly string[]): BtlWiden | null {
  const on = new Set(shown);
  let far: BtlFoundAt | null = null;
  for (const p of choice.picks) if (on.has(p.dealId) && (!far || FOUND_ORDER(p.found) > FOUND_ORDER(far))) far = p.found;
  if (!far || far.scope === 'own' || !choice.from) return null;
  return { from: choice.from, found: far };
}

/** "Not enough buy-to-let deals in Leeds today, so I looked up to 25 miles out." */
export function btlWidenLine(w: BtlWiden): string {
  const where = w.found.scope === 'miles' ? `I looked up to ${w.found.miles} miles out` : w.found.scope === 'region' ? `I looked across ${w.found.region}` : 'I looked across the UK';
  return `Not enough buy-to-let deals in ${w.from} today, so ${where}.`;
}

/** "24 miles from Leeds" on a card found beyond their own areas; null inside them. */
export function btlDistanceLabel(miles: number | null, from: string | null): string | null {
  if (miles === null || !from) return null;
  return `${Math.max(1, miles)} miles from ${from}`;
}

/** The stored line back (StoredChoice.btlWiden); null when it is not one. */
export function parseBtlWiden(raw: unknown): BtlWiden | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const f = r.found && typeof r.found === 'object' ? (r.found as Record<string, unknown>) : null;
  if (typeof r.from !== 'string' || !r.from || !f) return null;
  if (f.scope === 'miles' && typeof f.miles === 'number' && Number.isFinite(f.miles) && f.miles > 0) return { from: r.from, found: { scope: 'miles', miles: f.miles } };
  if (f.scope === 'region' && typeof f.region === 'string' && f.region) return { from: r.from, found: { scope: 'region', region: f.region } };
  if (f.scope === 'national') return { from: r.from, found: { scope: 'national' } };
  return null;
}
