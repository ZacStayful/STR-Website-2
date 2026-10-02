/**
 * Part D: Browse's "Best for you" (/deals, the default sort since Batch 14).
 *
 * Every deal the grid's filters match, in the member's own order:
 *   - the deals the order can use first. The rest (no deal figures, losing
 *     money, or a short-let check worse than "unknown") go last, best profit
 *     first, so the cards always add up to the total.
 *   - a tailored profile: fewest must-haves missed first (Browse sorts a miss
 *     lower and never hides it), then Today's own tailored order: short-let
 *     check, band, fewest nice-to-haves missed, most met, fit for you, profit.
 *   - no new answers: the shared fit (area fit and the deal's own points, as
 *     Today ranks), then profit.
 *   - the deal id last, so the order is total and pages never shuffle.
 *
 * It reads the card's own columns and four lean JSON paths
 * (BROWSE_RANK_COLUMNS), never the whole stored deal, and gives back ids.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { Deal } from '../listing/deal.ts';
import { parseMotivation } from '../listing/motivation.ts';
import { blendFit } from '../listing/pipeline.ts';
import { isBand } from '../listing/screen.ts';
import { MOTIVATION_LIFT } from '../listing/sourcing.ts';
import type { AreaCardData } from '../market/explorer.ts';
import type { MarketGoals } from '../market/goals.ts';
import { DEFAULT_FILTERS, type DealCard } from '../marketplace/grid.ts';
import { motivationFor } from '../today/candidates.ts';
import { candidateContext } from '../today/choose.ts';
import { CRITERIA, factsFromRow, judgeDeal, rentalFromCard, wantsFor } from './criteria.ts';
import { dealTypeOf } from '../profile/deal-types.ts';
import type { DealType } from '../market/goals.ts';
import { adjustmentsFor, areaLookup, bonusOf, compareKeys, leaningsFor, orderKey, type OrderKey } from './order.ts';
import { usesTailoring, type CriterionKey, type TailoringProfile } from './profile.ts';

/** What the order reads on top of the card: the short-let check and the fit's figures. No address, no link. */
export const BROWSE_RANK_COLUMNS = 'suitability, deal_yield:deal->>grossYieldPct, deal_target_yield:deal->>targetYieldPct, deal_target_margin:deal->>targetMarginPcm';

export interface BrowseRow extends DealCard {
  suitability?: unknown;
  deal_yield?: string | number | null;
  deal_target_yield?: string | number | null;
  deal_target_margin?: string | number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Enough of the stored deal for the shared fit (blendFit): null when the row carries no figures. */
export function leanDeal(row: BrowseRow): Deal | null {
  if (row.kind === 'sale') {
    const grossYieldPct = num(row.deal_yield);
    const targetYieldPct = num(row.deal_target_yield);
    return grossYieldPct !== null && targetYieldPct !== null ? ({ kind: 'purchase', grossYieldPct, targetYieldPct } as Deal) : null;
  }
  const monthlyMargin = num(row.deal_margin);
  const targetMarginPcm = num(row.deal_target_margin);
  return monthlyMargin !== null && targetMarginPcm !== null ? ({ kind: 'rent-to-rent', monthlyMargin, targetMarginPcm } as Deal) : null;
}

interface Scored {
  id: string;
  profit: number | null;
  /** Null: the order cannot use it (last). */
  key: OrderKey | null;
  mustMissed: number;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function compare(a: Scored, b: Scored): number {
  if (a.key && b.key) return a.mustMissed - b.mustMissed || compareKeys(a.key, b.key);
  if (a.key || b.key) return a.key ? -1 : 1;
  return (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || byId(a, b);
}

export interface BestForYouInput {
  goals: MarketGoals | null;
  tailoring: TailoringProfile | null | undefined;
  /** The market snapshot's area cards, when to hand without waiting; null: the deal's own figures carry the fit. */
  cards: readonly AreaCardData[] | null;
  now: Date;
}

export function bestForYouOrder(rows: readonly BrowseRow[], input: BestForYouInput): string[] {
  const p = usesTailoring(input.tailoring) ? input.tailoring : null;
  const goals = p?.goals ?? input.goals;
  const ctx = candidateContext(goals, DEFAULT_FILTERS, input.cards, input.now);
  const mode = goals?.motivation.mode ?? 'off';
  const wants = p ? wantsFor(p) : null;
  const leanings = p ? leaningsFor(p) : null;
  const area = areaLookup(input.cards);
  const scored: Scored[] = rows.map((row) => {
    const profit = num(row.annual_profit);
    const deal = leanDeal(row);
    const precheck = row.suitability === 'ok' ? 'ok' : row.suitability === 'unknown' || row.suitability == null ? 'unknown' : null;
    // The money test, as the shared ranking makes it: a deal that loses money is never "best".
    const losing = !deal || (deal.kind === 'rent-to-rent' ? deal.monthlyMargin <= 0 : deal.grossYieldPct <= 0);
    const base = precheck && !losing ? blendFit(deal, ctx.areaFit(row.postcode_area)) : null;
    if (base === null || !precheck) return { id: row.id, profit, key: null, mustMissed: 0 };
    const { motivation, qualifies } = motivationFor(row, goals, input.now);
    const lift = mode === 'off' ? 0 : Math.round((MOTIVATION_LIFT * (motivation?.score ?? 0)) / 100);
    const c = { precheck, screening: { band: isBand(row.band) ? row.band : 'qualified' as const }, fit: Math.min(100, base + lift) };
    if (!p || !wants || !leanings) return { id: row.id, profit, key: orderKey(c, undefined, 0, profit, row.id), mustMissed: 0 };
    const m = parseMotivation(row.motivation);
    const facts = factsFromRow(row, rentalFromCard(row), { qualifies, score: m?.score ?? 0, fired: m?.fired });
    const { judgement, figures } = judgeDeal(facts, p, wants);
    const bonus = bonusOf(adjustmentsFor(facts, figures, leanings, area(facts.area, facts.bedrooms)));
    return { id: row.id, profit, key: orderKey(c, judgement, bonus, profit, row.id), mustMissed: judgement.mustFails.length };
  });
  return scored.sort(compare).map((s) => s.id);
}

// ── Batch 22e: Browse is the deals picked for you ──

/** Why a deal is not in the member's list: a check it fails, or a deal type they did not choose. */
export type MissKey = CriterionKey | 'deal_type';

export interface ProfileFit {
  /** Empty: the deal matches the active profile. */
  misses: MissKey[];
}

/** "Budget", "Location", "Deal type": what a near miss misses, for its line on Browse. */
export function missLabel(k: MissKey): string {
  return k === 'deal_type' ? 'Deal type' : CRITERIA[k].label;
}

/**
 * Batch 22e, Part D: whether each deal matches the active profile, through the
 * one matcher (Batch 14's judgeDeal, the profile's deal types from Batch 17,
 * Batch 22c's budget brackets inside wantsFor, legacy 'u200' included). A deal
 * matches when it is one of the profile's deal types, is in its areas and
 * budget (whether the member made those must-haves or nice-to-haves: Browse
 * shows what was picked for them), and fails no must-have. A check that
 * cannot be made (unknown) is not a miss. The three questions every member
 * answers (where, budget, deal types) are enough: no further answers are
 * needed. Null when the profile has no answers at all: nothing to narrow,
 * Browse shows every deal.
 */
export function profileFits(rows: readonly BrowseRow[], p: TailoringProfile | null | undefined, types: readonly DealType[], now: Date): Map<string, ProfileFit> | null {
  if (!p || !p.goals) return null;
  const wants = wantsFor(p);
  const wanted = new Set(types);
  const out = new Map<string, ProfileFit>();
  for (const row of rows) {
    const misses: MissKey[] = [];
    if (wanted.size > 0 && !wanted.has(dealTypeOf(row))) misses.push('deal_type');
    const { qualifies } = motivationFor(row, p.goals, now);
    const m = parseMotivation(row.motivation);
    const facts = factsFromRow(row, rentalFromCard(row), { qualifies, score: m?.score ?? 0, fired: m?.fired });
    const { judgement } = judgeDeal(facts, p, wants);
    for (const c of judgement.checks) {
      if (c.verdict !== 'fail') continue;
      if (c.mode === 'must' || c.key === 'location' || c.key === 'budget') misses.push(c.key);
    }
    out.set(row.id, { misses: [...new Set(misses)] });
  }
  return out;
}

/** The nearest deals when none matches: fewest misses first, then the given order; at most `n`. */
export function nearestMisses(order: readonly string[], fits: ReadonlyMap<string, ProfileFit>, n = 10): string[] {
  const at = new Map(order.map((id, i) => [id, i]));
  return order
    .filter((id) => (fits.get(id)?.misses.length ?? 0) > 0)
    .sort((a, b) => fits.get(a)!.misses.length - fits.get(b)!.misses.length || at.get(a)! - at.get(b)!)
    .slice(0, n);
}

const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The grid's other sorts, applied to the member's own list (the SQL order, in memory). */
export function sortRows(rows: readonly BrowseRow[], sort: 'profit' | 'uplift' | 'newest' | 'price'): string[] {
  const id = (a: BrowseRow, b: BrowseRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const list = [...rows];
  if (sort === 'uplift') list.sort((a, b) => numOr(b.uplift_pct, -Infinity) - numOr(a.uplift_pct, -Infinity) || numOr(b.annual_profit, -Infinity) - numOr(a.annual_profit, -Infinity) || id(a, b));
  else if (sort === 'newest') list.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at) || id(a, b));
  else if (sort === 'price') list.sort((a, b) => numOr(a.price_amount, Infinity) - numOr(b.price_amount, Infinity) || id(a, b));
  else list.sort((a, b) => numOr(b.annual_profit, -Infinity) - numOr(a.annual_profit, -Infinity) || id(a, b));
  return list.map((r) => r.id);
}
