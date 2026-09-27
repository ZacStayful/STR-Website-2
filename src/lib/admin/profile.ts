/**
 * The admin's view of the profile quiz (Batch 12): how many members have
 * started and completed it, how far the rest have got, and the question
 * where they most often stop. The accounts Weekly active leaves out (admin,
 * staff, switched off) are left out here too, by the caller.
 *
 * Pure: no network, no database, no server-only.
 */
import { questionById, SECTION_TITLES, type QuestionId } from '../profile/questions.ts';

export interface QuizFact {
  userId: string;
  startedAt: string | null;
  completedAt: string | null;
  /** The last question they were on (the quiz row), for the drop-off table. */
  lastQuestion: QuestionId | null;
  percent: number;
  complete: boolean;
  /** The questions answered "Not sure". */
  notSure: QuestionId[];
}

export interface QuestionCount {
  question: QuestionId;
  label: string;
  count: number;
}

export interface ProfileStats {
  /** Members counted (after exclusions). */
  members: number;
  started: number;
  completed: number;
  notStarted: number;
  /** completed / started, or null with nobody started. */
  completionRate: number | null;
  /** Of the incomplete: the middle and the mean percentage. */
  medianPercent: number | null;
  averagePercent: number | null;
  /** Where the incomplete stopped, most common first. */
  dropOff: QuestionCount[];
  /** "Not sure" by question, most common first. */
  notSure: QuestionCount[];
}

/** "About you · Deals done" */
export function questionLabel(id: QuestionId): string {
  const q = questionById(id);
  return q ? `${SECTION_TITLES[q.section]} · ${q.short}` : id;
}

function counts(ids: readonly QuestionId[]): QuestionCount[] {
  const by = new Map<QuestionId, number>();
  for (const id of ids) by.set(id, (by.get(id) ?? 0) + 1);
  return [...by.entries()].map(([question, count]) => ({ question, label: questionLabel(question), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `facts` is one per member who has a quiz row (or would be seeded with one);
 * `members` is how many accounts count at all, so "not started" is the rest.
 */
export function aggregateProfileStats(facts: readonly QuizFact[], members: number): ProfileStats {
  const started = facts.filter((f) => f.startedAt !== null);
  const completed = started.filter((f) => f.complete);
  const incomplete = started.filter((f) => !f.complete);
  const percents = incomplete.map((f) => f.percent);
  return {
    members,
    started: started.length,
    completed: completed.length,
    notStarted: Math.max(0, members - started.length),
    completionRate: started.length > 0 ? completed.length / started.length : null,
    medianPercent: median(percents),
    averagePercent: percents.length > 0 ? percents.reduce((a, b) => a + b, 0) / percents.length : null,
    dropOff: counts(incomplete.map((f) => f.lastQuestion).filter((q): q is QuestionId => q !== null)),
    notSure: counts(started.flatMap((f) => f.notSure)),
  };
}

/** "62%" / "—" */
export function pctLabel(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}
