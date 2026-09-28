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
import { factsFromRow, judgeDeal, rentalFromCard, wantsFor } from './criteria.ts';
import { adjustmentsFor, areaLookup, bonusOf, compareKeys, leaningsFor, orderKey, type OrderKey } from './order.ts';
import { usesTailoring, type TailoringProfile } from './profile.ts';

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
