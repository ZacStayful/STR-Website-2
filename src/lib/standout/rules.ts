/**
 * Batch 25: when a new deal is a STANDOUT for a member, decided by Zac:
 *
 *   judged on the member's PRIMARY profile only (Batch 22's primaryOf), and
 *   only for the deal types that profile chose (Batch 17's dealTypesFor);
 *   the SAME judging Today and the reveal use (judgeRow → judgeDeal), never a
 *   second scoring path;
 *   no must-have missed (Today's own pool rule);
 *   at least minChecked answers checked, and a match (met ÷ checked, the %
 *   the member sees) of at least minMatchPct and at least their signup
 *   reveal's #1 (no reveal: the floor alone);
 *   the profit the profit check reads — the LOW end of the range, or for a
 *   BRRR project Batch 17's profit after the works (after refinance for a
 *   full project) — at least profitOverMinPct above the member's minimum
 *   for that deal type. No real minimum-profit answer: never standout.
 *
 * The run (run.ts) then adds what needs the database: the deal is new to the
 * member, confirmed live recently, beats what they've already been shown,
 * and is the best of the day.
 *
 * Pure.
 */
import { minProfitFor, typeOfFacts, type DealFacts, type Judgement, type MemberFigures, type Wants } from '../tailoring/criteria.ts';
import type { DealType } from '../profile/deal-types.ts';
import type { StandoutSettings } from './settings.ts';
import type { StandoutReason } from './reasons.ts';

export type ProfitBasis = 'range' | 'after_works' | 'after_refinance';

export interface StandoutJudgement {
  outcome: 'standout' | 'not_standout';
  reason: StandoutReason;
  /** False for a deal outside the member's types or missing a must-have: it never reaches their pool, so no row is kept. */
  inPool: boolean;
  dealType: DealType;
  /** The % the member sees (matchLine's rounding); null with nothing checked. */
  matchPct: number | null;
  met: number;
  checked: number;
  /** The profit figure the profit check reads, £ a month (low end). */
  profitLow: number | null;
  profitBasis: ProfitBasis;
  /** The member's minimum for this deal type, £ a month. */
  minProfit: number | null;
  /** What profitLow must reach: the minimum plus profitOverMinPct. */
  profitBar: number | null;
}

export interface StandoutInput {
  judgement: Judgement;
  facts: Pick<DealFacts, 'kind' | 'dealType' | 'project'>;
  figures: Pick<MemberFigures, 'range'>;
  wants: Pick<Wants, 'minProfit' | 'minProfitR2r'>;
  chosenTypes: readonly DealType[];
  /** The member's signup reveal #1's match % now, or null (no reveal, or it has gone). */
  revealPct: number | null;
  settings: Pick<StandoutSettings, 'minMatchPct' | 'minChecked' | 'profitOverMinPct'>;
  /** Admin's test helper: every threshold is skipped (types and must-haves still apply). */
  forced?: boolean;
}

/** The % the member sees: matchLine's own rounding (src/lib/tailoring/why.ts). */
export function matchPctOf(j: Pick<Judgement, 'met' | 'checked'>): number | null {
  return j.checked > 0 ? Math.round((j.met / j.checked) * 100) : null;
}

export function profitBasisOf(facts: Pick<DealFacts, 'project'>): ProfitBasis {
  const project = facts.project as { level?: string } | null | undefined;
  if (!project) return 'range';
  return project.level === 'full' ? 'after_refinance' : 'after_works';
}

/** The minimum plus the margin, rounded up to the pound. */
export function profitBarFor(minProfit: number, overPct: number): number {
  return Math.ceil((minProfit * (100 + overPct)) / 100);
}

export function judgeStandout(i: StandoutInput): StandoutJudgement {
  const j = i.judgement;
  const dealType = typeOfFacts(i.facts);
  const matchPct = matchPctOf(j);
  const profitLow = i.figures.range ? i.figures.range.lowPcm : null;
  const minProfit = minProfitFor(i.facts, i.wants);
  const profitBar = minProfit === null ? null : profitBarFor(minProfit, i.settings.profitOverMinPct);
  const base = { dealType, matchPct, met: j.met, checked: j.checked, profitLow, profitBasis: profitBasisOf(i.facts), minProfit, profitBar };
  const no = (reason: StandoutReason, inPool = true): StandoutJudgement => ({ outcome: 'not_standout', reason, inPool, ...base });

  if (!i.chosenTypes.includes(dealType)) return no('type_not_chosen', false);
  if (j.mustFails.length > 0) return no('must_have_missed', false);
  if (i.forced) return { outcome: 'standout', reason: 'forced', inPool: true, ...base };
  if (minProfit === null) return no('no_min_profit_for_type');
  if (j.checked < i.settings.minChecked) return no('too_few_checks');
  if (matchPct === null || matchPct < i.settings.minMatchPct) return no('match_below_floor');
  if (i.revealPct !== null && matchPct < i.revealPct) return no('below_reveal_match');
  if (profitLow === null) return no('profit_unknown');
  if (profitBar === null || profitLow < profitBar) return no('profit_short');
  return { outcome: 'standout', reason: 'standout', inPool: true, ...base };
}

/** A member nothing can be standout for, and why; null when they can be judged. */
export function memberSkip(i: {
  isTeamMember: boolean;
  primary: { forClient: boolean; pausedAt: string | null; awaitingAnswers?: boolean } | null;
  chosenTypes: readonly DealType[];
  wants: Pick<Wants, 'minProfit' | 'minProfitR2r'> | null;
}): StandoutReason | null {
  if (i.isTeamMember) return 'team_member';
  if (!i.primary) return 'no_primary_profile';
  if (i.primary.forClient) return 'client_profile';
  if (i.primary.pausedAt) return 'profile_paused';
  if (i.primary.awaitingAnswers) return 'awaiting_answers';
  if (i.chosenTypes.length === 0) return 'no_deal_types';
  const w = i.wants;
  if (!w || i.chosenTypes.every((t) => minProfitFor({ kind: t === 'r2r' ? 'rent' : 'sale' }, w) === null)) return 'no_min_profit';
  return null;
}

/** Best first: the highest match, then the highest profit (Zac: "the one with the highest match (then highest profit)"). */
export function bestFirst<T extends { matchPct: number | null; profitLow: number | null }>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => (b.matchPct ?? -1) - (a.matchPct ?? -1) || (b.profitLow ?? -Infinity) - (a.profitLow ?? -Infinity));
}

/**
 * "Matches you better than anything I've found so far": a standout must make
 * more than every deal at least as good a match that the member was already
 * shown or had saved (null: nothing to beat).
 */
export function beatsBest(profitLow: number, bestSoFar: number | null): boolean {
  return bestSoFar === null || profitLow > bestSoFar;
}

/** Confirmed live recently enough to call about: a page read for a portal we can read, the feed's sighting for one we can't. */
export function liveConfirmed(d: { fetchable: boolean; lastCheckedLiveAt: string | null; lastConfirmedAt: string | null }, now: Date, hours: number): boolean {
  const iso = d.fetchable ? d.lastCheckedLiveAt : d.lastConfirmedAt ?? d.lastCheckedLiveAt;
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now.getTime() - t <= hours * 3_600_000;
}

/**
 * Whether a deal went live inside the window this pass judges for this
 * member. Paying members hear the moment it goes live; free members once the
 * free delay has passed (the same delay as the deal itself), or at once for a
 * deal their own search found (Batch 22's ownFinds).
 */
export function inWindow(liveSinceIso: string | null, w: { from: string; to: string }): boolean {
  if (!liveSinceIso) return false;
  const t = Date.parse(liveSinceIso);
  return Number.isFinite(t) && t > Date.parse(w.from) && t <= Date.parse(w.to);
}

/** How many more standouts may be saved for a member today (maxPerDay 0 = no limit). */
export function savesLeftToday(savedToday: number, maxPerDay: number): number {
  if (maxPerDay <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, maxPerDay - savedToday);
}
