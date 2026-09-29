/**
 * The one-off move of existing profiles onto deal types (Batch 17, Part I):
 * what each profile's older answers become, and what the dry run prints.
 * The mapping is deal-types.ts legacyDealTypes, decided 29 Sep:
 *
 *   investor → Buy and let; r2r → Rent-to-rent; both → both
 *   sourcers by who they source for (both, or unanswered: both)
 *   exploring by what they picked; managers from their path (Buy and let)
 *   Condition light refresh or full project → also BRRR, its budget a copy
 *     of the buy budget (Q19), its work: refresh → Light, project → Either (Q24)
 *   the rent-to-rent minimum profit copied from the one shared field
 *
 * A profile that already has types is left alone, so a second run changes
 * nothing. One with nothing to go on is left too: it meets the question on
 * its next visit (Q22). The questions the move answers are marked answered,
 * so a member who had passed the welcome gate is not sent back through it.
 *
 * Nothing printed is an address, a postcode, an email or a listing: short
 * ids, the profile's own name and the answers' option keys.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MarketGoals } from '../market/goals.ts';
import type { AboutYou } from './about.ts';
import { kindsFor, legacyDealTypes, type DealType } from './deal-types.ts';
import type { AnsweredMap } from './state.ts';
import type { QuestionId } from './questions.ts';

export interface BackfillBefore {
  roles: string[];
  mainRole: string | null;
  exploringPick: string | null;
  path: string | null;
  kind: string;
  sourceFor: string | null;
  condition: string | null;
  budget: string | null;
}

export interface BackfillAfter {
  types: DealType[];
  brrrBudget: string | null;
  brrrWork: string | null;
  r2rMinProfit: number | null;
}

export type BackfillOutcome =
  | { status: 'map'; goals: MarketGoals; marks: AnsweredMap; after: BackfillAfter }
  | { status: 'already' | 'nothing' | 'no_goals' };

export function beforeOf(goals: MarketGoals | null, about: AboutYou | null): BackfillBefore {
  return {
    roles: [...(about?.roles ?? [])],
    mainRole: about?.mainRole ?? null,
    exploringPick: about?.exploringPick ?? null,
    path: goals?.path ?? null,
    kind: goals?.sourcingKind ?? 'sale',
    sourceFor: goals?.sourcer.sourceFor ?? null,
    condition: goals?.buyer.condition ?? null,
    budget: goals?.budget ?? null,
  };
}

/** What one profile becomes, and the marks to add. `now` stamps the marks. */
export function backfillProfile(goals: MarketGoals | null, about: AboutYou | null, marks: AnsweredMap, now: Date): BackfillOutcome {
  if (!goals) return { status: 'no_goals' };
  if (goals.dealTypes && goals.dealTypes.length > 0) return { status: 'already' };
  const types = legacyDealTypes({ goals, about });
  if (types.length === 0) return { status: 'nothing' };
  const brrr = types.includes('brrr');
  const condition = goals.buyer.condition;
  const brrrBudget = brrr ? goals.brrr.budget ?? goals.budget : goals.brrr.budget;
  const brrrWork = brrr ? goals.brrr.work ?? (condition === 'refresh' ? 'light' : 'either') : goals.brrr.work;
  const r2rMin = types.includes('r2r') ? goals.r2r.minMarginPcm ?? goals.finance.targetMarginPcm : goals.r2r.minMarginPcm;
  const next: MarketGoals = {
    ...goals,
    dealTypes: types,
    sourcingKind: kindsFor(types),
    brrr: { ...goals.brrr, budget: brrrBudget, work: brrrWork },
    r2r: { ...goals.r2r, minMarginPcm: r2rMin },
  };
  const at = now.toISOString();
  const mark = { at, notSure: false };
  const added: AnsweredMap = { deal_types: mark };
  // BRRR only ever comes from a Condition they gave (refresh or project): its budget and work are answers too.
  if (brrr && brrrBudget && !marks.brrr_budget) added.brrr_budget = mark;
  if (brrr && !marks.brrr_work) added.brrr_work = mark;
  return {
    status: 'map',
    goals: next,
    marks: { ...marks, ...added },
    after: { types, brrrBudget: next.brrr.budget, brrrWork: next.brrr.work, r2rMinProfit: types.includes('r2r') ? r2rMin : null },
  };
}

/** The first eight characters of an id: enough to find the row, nothing more. */
export function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}

/** The questions the move can mark (for the report). */
export const BACKFILL_MARKS: readonly QuestionId[] = ['deal_types', 'brrr_budget', 'brrr_work'];
