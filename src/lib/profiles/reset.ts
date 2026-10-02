/**
 * Batch 22d: "Start again" and "Start blank", the rules with no database.
 *
 * Start again resets the member's ACTIVE saved profile: its answers (and, if
 * they choose, "About you", which every profile shares), the deals they track
 * for it that they choose to clear, and what Today learns from their Keeps,
 * Passes and opens for it. Start blank makes a new profile with no answers.
 * The writes are public.reset_search_profile (supabase/schema.sql, "Batch
 * 22d") and src/lib/profiles/server.ts.
 *
 *   - The £5 is never touched: it stays once per account (profile/credit.ts).
 *   - A cleared deal is hidden from My deals, never deleted and never a Pass:
 *     nothing here writes a Keep / Pass, an open or a stage.
 *   - Only the active profile's own deals can be cleared, and only ones the
 *     member was shown on the confirm screen.
 *   - Learning restarts: after a restart only what came later counts.
 *   - A profile with no mandatory search answers gets no daily deals and no
 *     charge until it has them (rules.ts seatsFor).
 *
 * Pure: no network, no database, no server-only.
 */
import { DEFAULT_GOALS } from '../market/goals.ts';
import { emptyAnswers } from '../profile/questions.ts';
import { EMPTY_QUIZ, progress, type AnsweredMap } from '../profile/state.ts';
import { SHARED_QUESTION_IDS, type SavedProfile } from './rules.ts';

export const RESET_ANSWERS = ['search', 'everything'] as const;
export type ResetAnswers = (typeof RESET_ANSWERS)[number];

export const RESET_DEALS = ['keep_all', 'clear_all', 'choose'] as const;
export type ResetDeals = (typeof RESET_DEALS)[number];

/** How long a cleared deal can be brought back from "Cleared deals". After that it stays hidden. */
export const RESTORE_DAYS = 30;

const DAY_MS = 86_400_000;

export function isResetAnswers(v: unknown): v is ResetAnswers {
  return typeof v === 'string' && (RESET_ANSWERS as readonly string[]).includes(v);
}

export function isResetDeals(v: unknown): v is ResetDeals {
  return typeof v === 'string' && (RESET_DEALS as readonly string[]).includes(v);
}

/** The quiz marks left after a reset: "About you"'s for 'search' (they stay), none for 'everything'. */
export function answersAfterReset(option: ResetAnswers, answered: AnsweredMap): AnsweredMap {
  if (option === 'everything') return {};
  const out: AnsweredMap = {};
  for (const id of SHARED_QUESTION_IDS) if (answered[id]) out[id] = answered[id];
  return out;
}

// ── Tracked deals ──

export interface ResetEntry {
  /** The My deals entry key: 'd-<deal id>' or 'l-<checked listing id>'. */
  key: string;
  /** The member's own entry (never a teammate's). */
  mine: boolean;
}

/**
 * The deals a reset may clear: the member's own My deals entries for the
 * active profile. An own entry with no profile tag counts as the active
 * profile's (a team member's opens are never tagged, and rows from before
 * saved profiles may not be); one tagged to another profile never does.
 */
export function resetCandidates(entries: readonly ResetEntry[], tags: ReadonlyMap<string, string>, activeProfileId: string): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (!e.mine) continue;
    const tag = tags.get(e.key);
    if (tag && tag !== activeProfileId) continue;
    if (!out.includes(e.key)) out.push(e.key);
  }
  return out;
}

/**
 * The keys to hide. Only ever candidates the member was shown on the confirm
 * screen (`shown`), so a deal tracked after the page was drawn, a posted key
 * that is not theirs, or another profile's deal is never hidden. 'choose'
 * hides the shown ones that were not ticked (`keep`).
 */
export function dealsToHide(p: { candidates: readonly string[]; choice: ResetDeals; shown: readonly string[]; keep: readonly string[] }): string[] {
  if (p.choice === 'keep_all') return [];
  const shown = new Set(p.shown);
  const base = p.candidates.filter((k) => shown.has(k));
  if (p.choice === 'clear_all') return base;
  const keep = new Set(p.keep);
  return base.filter((k) => !keep.has(k));
}

export interface HiddenRow {
  itemKey: string;
  hiddenAt: string;
  restoredAt: string | null;
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Whether a My deals entry is hidden: it was cleared, not restored, and the
 * member has not acted on it since (a Keep, a stage move or a Pass after the
 * clear brings it back on its own).
 */
export function hiddenNow(item: { lastChangedAt: string }, row: HiddenRow | undefined): boolean {
  if (!row || row.restoredAt) return false;
  const hidden = ms(row.hiddenAt);
  if (!Number.isFinite(hidden)) return false;
  const changed = ms(item.lastChangedAt);
  return !Number.isFinite(changed) || changed <= hidden;
}

/** A cleared deal that can still be brought back from "Cleared deals". */
export function restorable(row: HiddenRow, now: Date): boolean {
  if (row.restoredAt) return false;
  const hidden = ms(row.hiddenAt);
  return Number.isFinite(hidden) && now.getTime() - hidden <= RESTORE_DAYS * DAY_MS;
}

// ── Learning ──

/** Where a profile's learning window starts: the usual window, or its latest restart if that is later. */
export function learningSince(windowStart: Date, restartAt: string | null | undefined): Date {
  const r = ms(restartAt);
  return Number.isFinite(r) && r > windowStart.getTime() ? new Date(r) : windowStart;
}

/**
 * The learning entries that count after a restart: given at or after it. With
 * no restart, all of them. An entry with no time is dropped once there is a
 * restart (it cannot be shown to be newer).
 */
export function afterRestart<T>(entries: readonly T[], at: (e: T) => string | null | undefined, restartAt: string | null | undefined): T[] {
  const r = ms(restartAt);
  if (!Number.isFinite(r)) return [...entries];
  return entries.filter((e) => {
    const t = ms(at(e));
    return Number.isFinite(t) && t >= r;
  });
}

// ── Profiles waiting for answers ──

/**
 * A profile that has not answered its own mandatory search questions (deal
 * types, where, a money question per type): after a reset or as a blank
 * profile. "About you" ones are the member's and judged with the member.
 */
export function awaitingAnswers(p: Pick<SavedProfile, 'goals' | 'areas' | 'answered'>): boolean {
  const prog = progress(emptyAnswers(p.goals ?? DEFAULT_GOALS, null, p.areas), { ...EMPTY_QUIZ, answered: p.answered });
  return prog.mandatory.some((id) => !SHARED_QUESTION_IDS.includes(id) && !p.answered[id]);
}

// ── Writes ──

/** What reset_search_profile is sent. No credit and no completion field exists on it. */
export function resetPayload(p: { userId: string; answers: ResetAnswers; deals: ResetDeals; hide: readonly string[]; kept: number }): {
  user: string;
  answers: ResetAnswers;
  deals: ResetDeals;
  kept: number;
  cleared: number;
  shared: string[];
  hide: string[];
} {
  return { user: p.userId, answers: p.answers, deals: p.deals, kept: Math.max(0, p.kept), cleared: p.hide.length, shared: [...SHARED_QUESTION_IDS], hide: [...new Set(p.hide)] };
}

/** The one activity a reset logs: deduplicated on the reset's id, so a retry can never log it twice. */
export function restartActivity(restartId: string, p: { answers: ResetAnswers; kept: number; cleared: number }): { kind: 'profile_reset'; dedupeKey: string; extras: { answers: ResetAnswers; deals_kept: number; deals_cleared: number } } {
  return { kind: 'profile_reset', dedupeKey: `profile_reset:${restartId}`, extras: { answers: p.answers, deals_kept: p.kept, deals_cleared: p.cleared } };
}

/** A "Start blank" profile: no criteria, no areas, no answers, copied from nothing. */
export function blankProfileInput(p: { userId: string; name: string; forClient: boolean }): { user: string; name: string; criteria: null; areas: string[]; answered: Record<string, never>; for_client: boolean; copied_from: null } {
  return { user: p.userId, name: p.name, criteria: null, areas: [], answered: {}, for_client: p.forClient, copied_from: null };
}

// ── Admin ──

export interface RestartFact {
  userId: string;
  kind: 'reset' | 'blank';
  createdAt: string;
}

export interface ResetMetrics {
  /** Resets this week (Start blank is not a reset). */
  resets: number;
  /** Members behind them. */
  members: number;
  /** Of those members, how many Kept a deal within 7 days after a reset. */
  keptWithin7: number;
  /** Of those members, how many have had their full 7 days (the rest may still Keep). */
  settled: number;
}

/** The admin panel's figures for the week [weekStart, weekEnd). `keeps` are Keep events of those members. */
export function resetMetrics(restarts: readonly RestartFact[], keeps: readonly { userId: string; at: string }[], range: { start: Date; end: Date }, now: Date): ResetMetrics {
  const inWeek = restarts.filter((r) => r.kind === 'reset' && ms(r.createdAt) >= range.start.getTime() && ms(r.createdAt) < range.end.getTime());
  const byMember = new Map<string, number[]>();
  for (const r of inWeek) byMember.set(r.userId, [...(byMember.get(r.userId) ?? []), ms(r.createdAt)]);
  let kept = 0;
  let settled = 0;
  for (const [userId, times] of byMember) {
    const theirs = keeps.filter((k) => k.userId === userId).map((k) => ms(k.at));
    if (times.some((t) => theirs.some((k) => k > t && k <= t + 7 * DAY_MS))) kept += 1;
    if (Math.min(...times) + 7 * DAY_MS <= now.getTime()) settled += 1;
  }
  return { resets: inWeek.length, members: byMember.size, keptWithin7: kept, settled };
}
