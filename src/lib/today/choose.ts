/**
 * Choosing one member's Today list, as pure steps.
 *
 * The logic that was inline in selection.ts (chooseToday and its helpers),
 * moved here unchanged so it can be tested end to end: every read it makes is
 * passed in (`ChooseReads`), and everything else it depends on (the member's
 * goals, their feedback, what is excluded, the market snapshot's area cards,
 * the clock) is plain data. selection.ts keeps the reads themselves.
 *
 * The order of the reads matters as much as the answer: the near-miss path
 * reads a wider pool only when nothing matched, and a rewrite that read it
 * every time would cost every member a query. The tests record the reads.
 *
 * Nothing here returns an address, a postcode or a listing URL: the full
 * listings are read to apply the feedback rules and never leave.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { MarketGoals } from '../market/goals.ts';
import type { AreaCardData } from '../market/explorer.ts';
import { personaliseScore, personalInputFor } from '../market/personalise.ts';
import { areaMetaForCode } from '../market/areas.ts';
import { applyCandidateFeedback, feedbackRules, type AppliedRules, type PickFeedback } from '../listing/picks.ts';
import { rankForMember } from '../listing/rank.ts';
import { rankPicks, type SourcedListing } from '../listing/sourcing.ts';
import { isSendable } from '../listing/screen.ts';
import { analyseRelaxation, closestMatch, describeRelaxation } from '../listing/relax.ts';
import type { DealFilters } from '../marketplace/grid.ts';
import { applyKindFeedback, buildCandidate, CLOSEST_ADVICE, dealKey, filtersForGoals, nearestAreas, nearestOutside, orderForToday, referencePoint, WIDEN_AREA_ADVICE, type Built, type CandidateContext, type PoolRow, type TodayCandidate } from './candidates.ts';
import { TODAY_SIZE } from './day.ts';

/** Rows of the pool read for ranking: the best-profit end of what matches. */
export const POOL_LIMIT = 1000;
/** How deep the ranking reaches, as the picks run's SPREAD_DEPTH. */
export const DEPTH = 40;
/** Rows read when looking for the nearest thing to a search that matched nothing. */
export const NEAR_LIMIT = 400;
/** Areas searched outside the member's own when theirs hold nothing. */
export const NEARBY_AREAS = 12;

export interface TodayChoice {
  dealIds: string[];
  nearMiss: boolean;
  advice: string | null;
}

/** What choosing reads. The server wires these to the database (selection.ts); the tests to fixtures. */
export interface ChooseReads {
  /** The marketplace pool for these filters, as rankingPool reads it for this member: visibility applied, passes left out, best profit first. */
  pool: (filters: DealFilters, limit: number) => Promise<PoolRow[]>;
  /** The full stored listing of each deal, by deal id (deals with none are absent). Server-side only. */
  fullListings: (dealIds: string[]) => Promise<Map<string, SourcedListing>>;
}

export interface ChooseInput {
  goals: MarketGoals | null;
  savedAreas: readonly string[];
  /** The member's answers in the feedback window (feedbackForMember). */
  feedback: PickFeedback[];
  /** Deals that can never be on this Today (excludedFor). */
  exclude: ReadonlySet<string>;
  /** The market snapshot's area cards; null or empty on a cold cache, when the deal's own figures carry the fit. */
  cards: readonly AreaCardData[] | null;
  now: Date;
}

export async function chooseTodayFrom(input: ChooseInput, reads: ChooseReads): Promise<TodayChoice> {
  const { goals, feedback, exclude, now } = input;
  const rules = feedbackRules(feedback);
  const filters = applyKindFeedback(filtersForGoals(goals, input.savedAreas), rules);
  const mode = goals?.motivation.mode ?? 'off';
  const ctx = candidateContext(goals, filters, input.cards, now);
  const usable = (rows: PoolRow[]): Built[] => {
    const out: Built[] = [];
    for (const row of rows) {
      if (exclude.has(row.id)) continue;
      // "Wrong area" answers: the picks run stops searching there, Today stops showing it.
      if (row.postcode_area && rules.badAreas.has(row.postcode_area.toUpperCase())) continue;
      const built = buildCandidate(row, ctx);
      if (built) out.push(built);
    }
    return out;
  };

  // ── The day's list ──
  const pool = usable(await reads.pool(filters, POOL_LIMIT));
  const exact = pool.filter((b) => b.fails.length === 0).map((b) => b.candidate);
  const ranked = rankForMember(exact, feedback, rules, { depth: DEPTH, mode }).ranked;
  const top = await withFullListings(reads, orderForToday(ranked), feedback, rules);
  if (top.length > 0) return { dealIds: top.slice(0, TODAY_SIZE).map((c) => c.dealId), nearMiss: false, advice: null };

  // ── Nothing matched: the closest thing, and what to change ──
  // First inside their own areas, with the budget lifted: a row failing only
  // on price (or on time on market) is what tells relax.ts which setting is
  // costing them the most.
  const loose = usable(await reads.pool({ ...filters, minPrice: null, maxPrice: null }, NEAR_LIMIT));
  const misses = viableMisses(loose.filter((b) => b.fails.length > 0), feedback, rules);
  let closest: Built | null = null;
  if (misses.length > 0) {
    // Fewest failed settings first, then the seller most ready to deal (relax.ts).
    const best = closestMatch(
      misses.map((m) => m.near),
      (l) => misses.find((m) => m.near.listing === l)?.candidate.motivation?.score ?? 0,
    );
    const chosen = best ? misses.find((m) => m.near === best) ?? null : null;
    closest = chosen;
    const motiv = goals?.motivation ?? null;
    const kind = chosen?.candidate.listing.kind ?? 'sale';
    const relaxation = analyseRelaxation(
      misses.map((m) => m.near),
      { kind, thresholdUnits: motiv ? (kind === 'rent' ? motiv.minWeeksOnMarket : motiv.minMonthsOnMarket) : 0, maxPrice: filters.maxPrice, minBedrooms: null },
    );
    const advice = describeRelaxation(relaxation);
    if (chosen && advice) return { dealIds: [chosen.candidate.dealId], nearMiss: true, advice };
  }
  // Their areas hold nothing that works: the nearest deal just outside them.
  if (filters.areas.length > 0) {
    const own = new Set(filters.areas);
    const from = referencePoint(goals, filters.areas);
    const nearby = nearestAreas(from, own, NEARBY_AREAS);
    if (nearby.length > 0) {
      const wide = usable(await reads.pool({ ...filters, areas: nearby }, NEAR_LIMIT));
      const around = rankForMember(wide.filter((b) => b.fails.length === 0).map((b) => b.candidate), feedback, rules, { depth: NEAR_LIMIT, mode }).ranked;
      const checked = await withFullListings(reads, around, feedback, rules, around.length);
      const nearest = nearestOutside(checked, from, own);
      if (nearest) return { dealIds: [nearest.dealId], nearMiss: true, advice: WIDEN_AREA_ADVICE };
    }
  }
  // Something close, but no single setting would have admitted it.
  if (closest) return { dealIds: [closest.candidate.dealId], nearMiss: true, advice: CLOSEST_ADVICE };
  return { dealIds: [], nearMiss: false, advice: null };
}

/**
 * Near misses that could still be offered: past the member's feedback rules,
 * a deal that works (the money test the ranking applies), clearing the income
 * bar, and card-cleared if they asked for that. "Closest" never means a deal
 * the member already ruled out or one that loses money.
 */
export function viableMisses(misses: Built[], feedback: PickFeedback[], rules: AppliedRules): Built[] {
  const survivors = new Set(applyCandidateFeedback(misses.map((m) => m.candidate), feedback, rules).map((c) => c.dealId));
  const pass = misses.filter((m) => survivors.has(m.candidate.dealId));
  const works = new Set(rankPicks(pass.map((m) => m.candidate), pass.length, 'off').map((c) => c.dealId));
  return pass.filter((m) => works.has(m.candidate.dealId) && (!m.candidate.screening || isSendable(m.candidate.screening)) && (m.candidate.precheck === 'ok' || !rules.strictSuitability));
}

/**
 * The member's fit for each area (their personal score with goals, else
 * Stayful's), the area names, and their price bounds, as buildCandidate reads
 * them. Without the market snapshot (a cold cache) every area's fit is
 * unknown and the deal's own figures carry the fit.
 */
export function candidateContext(goals: MarketGoals | null, filters: DealFilters, cards: readonly AreaCardData[] | null, now: Date): CandidateContext {
  const byCode = new Map((cards ?? []).map((c) => [c.code, c]));
  const fits = new Map<string, number | null>();
  return {
    goals,
    areaFit: (code) => {
      if (!code) return null;
      if (fits.has(code)) return fits.get(code)!;
      const card = byCode.get(code);
      const fit = !card ? null : goals ? personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null : card.score?.score ?? null;
      fits.set(code, fit);
      return fit;
    },
    areaName: (code) => (code ? byCode.get(code)?.name ?? areaMetaForCode(code).name : 'the UK'),
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    now,
  };
}

/**
 * The last pass of the feedback rules, on the full stored listing of each
 * ranked deal. The card's columns carry no title, features or price
 * qualifier, and "needs too much work" (and a title-only flat or house)
 * reads those. The full listing is read server-side and never leaves: what
 * comes back is the same candidate, with its public listing.
 */
export async function withFullListings<C extends TodayCandidate>(reads: ChooseReads, ranked: C[], feedback: PickFeedback[], rules: AppliedRules, limit = DEPTH): Promise<C[]> {
  const head = ranked.slice(0, limit);
  if (head.length === 0) return [];
  const snapshots = await reads.fullListings(head.map((c) => c.dealId));
  const full = head.map((c) => {
    const snap = snapshots.get(c.dealId);
    // The stand-in URL is kept, so nothing downstream is keyed on the real one.
    return snap ? { ...c, listing: { ...snap, canonicalUrl: dealKey(c.dealId) } } : c;
  });
  const kept = new Set(applyCandidateFeedback(full, feedback, rules).map((c) => c.dealId));
  return head.filter((c) => kept.has(c.dealId));
}
