/**
 * One saved profile's tailoring: everything Batch 14 reads to decide what
 * that profile's Today shows, in what order, and what each card says.
 *
 * Built by one loader (server.ts tailoringForSeats) for the Today page and
 * both daily runs alike, from:
 *   - the profile's search answers (Batch 12's MarketGoals, per profile since
 *     Batch 13) and its "specific areas"
 *   - the member's own "About you" answers, which every profile shares
 *   - the quiz's answered marks: the profile's own, with the member's for
 *     the shared About-you questions (a real answer and "Not sure" both leave
 *     a mark; only a real answer changes anything)
 *   - the member's must-have / nice-to-have overrides for the profile
 *   - what they showed they liked in the last 60 days (Keeps, their own
 *     opens, Full analyses)
 *
 * A profile with none of the new answers is not tailored (usesTailoring):
 * its Today is chosen exactly as before this batch.
 *
 * Pure: no network, no database, no server-only.
 */
import type { DealType, MarketGoals } from '../market/goals.ts';
import { DEFAULT_ABOUT, type AboutYou } from '../profile/about.ts';
import type { AnsweredMap } from '../profile/state.ts';
import { questionById, type QuestionId } from '../profile/questions.ts';
import { SHARED_QUESTION_IDS } from '../profiles/rules.ts';
import { TAILORING } from './config.ts';

/** The member's answers that can decide whether a deal is shown (Part A). */
export const CRITERION_KEYS = ['location', 'budget', 'cash', 'work', 'rent', 'profit', 'bedrooms', 'type', 'leasehold', 'restricted', 'setup', 'breakeven', 'payback', 'motivation'] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

export type Mode = 'must' | 'nice';
/** Overrides of the default mode, per criterion; anything absent is the default. */
export type FilterModes = Partial<Record<CriterionKey, Mode>>;

/**
 * Motivated sellers has no switch: the answer itself is the mode ("only" is a
 * must-have, "prefer" a nice-to-have), so a switch beside it would be a
 * second way of saying the same thing.
 */
export const SWITCHABLE: readonly CriterionKey[] = CRITERION_KEYS.filter((k) => k !== 'motivation');

export function isCriterionKey(v: unknown): v is CriterionKey {
  return typeof v === 'string' && (CRITERION_KEYS as readonly string[]).includes(v);
}

export function isSwitchable(v: unknown): v is CriterionKey {
  return isCriterionKey(v) && SWITCHABLE.includes(v);
}

/** A stored filter_modes value, tolerant of anything malformed: unknown keys and values are dropped. */
export function parseFilterModes(raw: unknown): FilterModes {
  const out: FilterModes = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isSwitchable(k) && (v === 'must' || v === 'nice')) out[k] = v;
  return out;
}

/** Something the member did that says they liked a deal. */
export interface Signal {
  dealId: string;
  source: 'keep' | 'open' | 'analysis';
  /** When (ISO). */
  at: string;
  kind: 'sale' | 'rent';
  propertyKind: 'flat' | 'house' | 'unknown';
  bedrooms: number | null;
  area: string | null;
  /** Sale price, or rent a month. */
  amount: number | null;
  /** Batch 17: the deal's own type (a sale with a Project estimate is BRRR); absent reads as its kind's. */
  dealType?: DealType;
}

/** Batch 10's profit range half-widths by confidence (billing_settings.profit_range_pct). */
export interface RangeWidths {
  high: number;
  medium: number;
  low: number;
}

export interface TailoringProfile {
  /** The saved profile (Batch 13); null for a member with no profile row yet. */
  profileId: string | null;
  goals: MarketGoals | null;
  savedAreas: string[];
  /** The member's own "About you": every profile shares it. */
  about: AboutYou;
  /** The quiz's marks for this profile, the shared About-you ones from the member. */
  answered: AnsweredMap;
  modes: FilterModes;
  /** Newest first, inside the signal window. */
  signals: Signal[];
  widths: RangeWidths;
}

/**
 * The profile's own marks, with the member's own for the questions every
 * profile shares (a profile that is not active keeps the About-you marks it
 * had when it was last active; the member's are the current ones).
 */
export function mergeMarks(profileMarks: AnsweredMap, memberMarks: AnsweredMap): AnsweredMap {
  const out: AnsweredMap = {};
  for (const [id, mark] of Object.entries(profileMarks) as [QuestionId, AnsweredMap[QuestionId]][]) if (mark && !SHARED_QUESTION_IDS.includes(id)) out[id] = mark;
  for (const id of SHARED_QUESTION_IDS) if (memberMarks[id]) out[id] = memberMarks[id];
  return out;
}

/** Answered with a real answer, not "Not sure". */
export function realAnswer(p: Pick<TailoringProfile, 'answered'>, id: QuestionId): boolean {
  const m = p.answered[id];
  return Boolean(m) && !m!.notSure;
}

/**
 * Whether the question is one this profile is asked: a buyer's answers do not
 * judge a profile that no longer wants to buy because it once did (Batch 17:
 * by the deal types it wants and the roles ticked). A profile with nothing to
 * route by yet (answered before the quiz) is judged on what it has.
 */
export function asked(p: Pick<TailoringProfile, 'goals' | 'about' | 'savedAreas'>, id: QuestionId): boolean {
  if (!p.goals) return false;
  // Nothing to route by yet (answered before the quiz): judged on what it has.
  if (p.about.roles.length === 0 && p.goals.dealTypes === null && p.goals.path === null) return true;
  const q = questionById(id);
  return !q?.applies || q.applies({ goals: p.goals, about: p.about, savedAreas: p.savedAreas });
}

/**
 * The questions whose answers Today already read before Batch 14 (the kind
 * searched, where, the budget or rent ceiling, motivated sellers), and
 * Batch 17's deal types and project budget, which choose the same way.
 * Answering them does not by itself move a member onto the tailored path:
 * they are judged there exactly as they were.
 */
const ALREADY_READ: readonly QuestionId[] = ['roles', 'deal_types', 'where', 'budget', 'brrr_budget', 'max_rent', 'motivated_sellers'];

/**
 * Tailored: any other quiz question answered for real, a must-have /
 * nice-to-have override, a bedrooms preference (the one pre-quiz answer
 * Today now uses), or something liked in the signal window. Otherwise
 * Today is chosen exactly as it was before this batch.
 */
export function usesTailoring(p: TailoringProfile | null | undefined): p is TailoringProfile {
  if (!p) return false;
  if (Object.keys(p.modes).length > 0) return true;
  if (p.goals?.bedrooms != null) return true;
  if (p.signals.length > 0) return true;
  return (Object.keys(p.answered) as QuestionId[]).some((id) => !ALREADY_READ.includes(id) && realAnswer(p, id));
}

/** The start of the signal window. */
export function signalSince(now: Date): Date {
  return new Date(now.getTime() - TAILORING.signalWindowDays * 86_400_000);
}

/** A profile with nothing but its goals: what a member who has never answered anything new has. */
export function plainProfile(goals: MarketGoals | null, savedAreas: readonly string[], widths: RangeWidths, over: Partial<TailoringProfile> = {}): TailoringProfile {
  return { profileId: null, goals, savedAreas: [...savedAreas], about: DEFAULT_ABOUT, answered: {}, modes: {}, signals: [], widths, ...over };
}

/**
 * A management company looking for landlords (Q15): Today offers them a
 * Leads page, unless whoever pays for them already owns one (the caller
 * checks that).
 */
export function wantsLandlordLeads(p: TailoringProfile | null | undefined): boolean {
  const g = p?.goals;
  if (!p || !g || !p.about.roles.includes('manager') || !asked(p, 'looking_for')) return false;
  return g.manager.lookingFor === 'landlords' || g.manager.lookingFor === 'both';
}

/** A deal sourcer (Q14): their share button leads, as "Share with an investor". */
export function sharesWithInvestors(p: TailoringProfile | null | undefined): boolean {
  return p?.about.roles.includes('sourcer') ?? false;
}
