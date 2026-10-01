/**
 * Batch 22, Part A: match accuracy levels.
 *
 *   0 Waking up             until the mandatory questions are done
 *   1 Basic                 the mandatory questions done
 *   2 Advanced              real optional answers ≥ ceil(optional × accuracy_advanced_pct)
 *   3 Stayful Intelligence  real answers ≥ the profile credit's count
 *                           (realAnswersNeeded with profile_credit_min_real_pct)
 *
 * "Not sure" never counts. When the questions left can't reach the next level,
 * `next.changeNotSure` says how many "Not sure" answers must become real.
 *
 * Pure: no network, no database, no server-only.
 */
import { realAnswersNeeded } from './credit.ts';

export type Level = 0 | 1 | 2 | 3;

export const LEVEL_NAMES: Record<Level, string> = {
  0: 'Waking up',
  1: 'Basic',
  2: 'Advanced',
  3: 'Stayful Intelligence',
};

export interface LevelInput {
  /** Questions that apply to this member (Progress.questions.length). */
  questions: number;
  /** Mandatory questions that apply (Progress.mandatory.length). */
  mandatory: number;
  mandatoryDone: boolean;
  /** Answered questions (Progress.answered.length) and the real ones among them (Progress.real). */
  answered: number;
  real: number;
  /** Real answers among the mandatory questions. */
  realMandatory: number;
}

export interface LevelSettings {
  advancedPct: number;
  /** profile_credit_min_real_pct: the top level is the profile credit's count. */
  siPct: number;
}

export interface AccuracyLevel {
  level: Level;
  name: string;
  /** The next level and what it takes; null at the top. */
  next: { level: Level; name: string; needed: number; changeNotSure: number } | null;
}

const clampPct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

/** Real optional answers Advanced needs. */
export function advancedNeeded(p: Pick<LevelInput, 'questions' | 'mandatory'>, advancedPct: number): number {
  const optional = Math.max(0, p.questions - p.mandatory);
  return Math.ceil((optional * clampPct(advancedPct)) / 100);
}

export function accuracyLevel(p: LevelInput, s: LevelSettings): AccuracyLevel {
  const unanswered = Math.max(0, p.questions - p.answered);
  const realOptional = Math.max(0, p.real - p.realMandatory);
  const advNeed = advancedNeeded(p, s.advancedPct);
  const siNeed = realAnswersNeeded({ questions: p.questions, mandatory: p.mandatory, minRealPct: clampPct(s.siPct) });

  const level: Level = !p.mandatoryDone ? 0 : p.real >= siNeed && p.mandatoryDone ? 3 : realOptional >= advNeed ? 2 : 1;
  const step = (to: Level, needed: number) => {
    const n = Math.max(0, needed);
    // Answers still open can supply the rest; beyond that a "Not sure" must change.
    const changeNotSure = Math.max(0, n - unanswered);
    return { level: to, name: LEVEL_NAMES[to], needed: n, changeNotSure };
  };

  let next: AccuracyLevel['next'] = null;
  if (level === 0) {
    const mandatoryLeft = Math.max(1, p.mandatory - p.realMandatory);
    next = { level: 1, name: LEVEL_NAMES[1], needed: mandatoryLeft, changeNotSure: 0 };
  } else if (level === 1) next = step(2, advNeed - realOptional);
  else if (level === 2) next = step(3, siNeed - p.real);
  return { level, name: LEVEL_NAMES[level], next };
}

/** "Match accuracy · Advanced" */
export function accuracyLabel(l: Pick<AccuracyLevel, 'name'>): string {
  return `Match accuracy · ${l.name}`;
}

/** The line under the accuracy bar. */
export function accuracyHint(l: AccuracyLevel): string {
  if (!l.next) return 'Stayful Intelligence unlocked. Every answer from here sharpens my picks.';
  const n = l.next.changeNotSure;
  if (n > 0) return `Change ${n} “Not sure” answer${n === 1 ? '' : 's'} to unlock ${l.next.name}.`;
  const k = l.next.needed;
  if (l.level === 0) return `Answer ${k} more and I can start matching you.`;
  return `Answer ${k} more to unlock ${l.next.name}.`;
}

/** "Advanced unlocked": shown for under a second when a level is reached. */
export function levelUpLabel(level: Level): string | null {
  return level === 0 ? null : `${LEVEL_NAMES[level]} unlocked`;
}

/** Where each level's marker sits on the bar (0–100), from the same counts. */
export function levelMarkers(p: Pick<LevelInput, 'questions' | 'mandatory'>, s: LevelSettings): Record<1 | 2 | 3, number> {
  const total = Math.max(1, p.questions);
  const adv = p.mandatory + advancedNeeded(p, s.advancedPct);
  const si = realAnswersNeeded({ questions: p.questions, mandatory: p.mandatory, minRealPct: clampPct(s.siPct) });
  const at = (n: number) => Math.min(100, Math.round((n / total) * 100));
  return { 1: at(p.mandatory), 2: at(adv), 3: at(Math.max(adv, si)) };
}
