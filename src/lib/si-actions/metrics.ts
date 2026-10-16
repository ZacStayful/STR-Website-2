/**
 * Batch 27: the sums behind the Actions panels on /admin/intelligence/actions.
 * Pure: the rows come from admin-server.ts (instructions, their steps, what
 * each charged step's own code charged, the question's AI line, and the
 * activity log for next-week weekly active).
 */
import { ukDay, ukWeekStart, addDays } from '../activity/week.ts';
import { CHARGED_KINDS, STEP_KINDS, UNDOABLE_KINDS, type StepKind } from './config.ts';

export interface InstructionFact {
  id: string;
  userId: string | null;
  createdAt: string;
  status: string;
  decision: string;
  confirmKind: string | null;
  confirmAnswer: string | null;
  chargedStartedAt: string | null;
  stoppedAt: string | null;
  reportKind: string | null;
  /** It had steps: a question that only filed a report or offered a feature request is not an instruction. */
  planned: boolean;
  /** Blocked for credit after a yes, or a charged step skipped because the balance didn't cover it when its turn came. */
  ranOutOfCredit?: boolean;
}

export interface StepFact {
  instructionId: string;
  action: StepKind;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  undoneAt: string | null;
  errorCode: string | null;
  autoReported: boolean;
  /** What the step's own code charged (base pence); null when not known (a link check is metered: its typical price stands in). */
  chargedBasePence: number | null;
  /** The typical price, for steps whose own charge isn't recorded against them. */
  estimateBasePence: number;
}

/** The question's own line (chat_turns), keyed by the instruction id it shares. */
export interface TurnMoney {
  id: string;
  rawPence: number;
  chargedBasePence: number;
}

/** A step that happened (for a charged step: started and charged by its own code). */
export const HAPPENED: ReadonlySet<string> = new Set(['done', 'handed_out']);

export type ActionCounts = Record<StepKind, number>;

const zeroCounts = (): ActionCounts => Object.fromEntries(STEP_KINDS.map((k) => [k, 0])) as ActionCounts;

export interface ActionDay {
  day: string;
  counts: ActionCounts;
  total: number;
  instructions: number;
}

/** Actions carried out per UK day by type, the newest day first, every day in the window (zeros included). */
export function actionsPerDay(instructions: readonly InstructionFact[], steps: readonly StepFact[], days: number, now: Date): ActionDay[] {
  const out = new Map<string, ActionDay>();
  for (let i = 0; i < days; i++) {
    const day = ukDay(new Date(now.getTime() - i * 86_400_000));
    out.set(day, { day, counts: zeroCounts(), total: 0, instructions: 0 });
  }
  for (const s of steps) {
    if (!HAPPENED.has(s.status)) continue;
    const d = out.get(ukDay(new Date(s.finishedAt ?? s.createdAt)));
    if (!d) continue;
    d.counts[s.action] += 1;
    d.total += 1;
  }
  for (const i of instructions) {
    if (i.status === 'cancelled' || !i.planned) continue;
    const d = out.get(ukDay(new Date(i.createdAt)));
    if (d) d.instructions += 1;
  }
  return [...out.values()];
}

export interface ActionMoney {
  action: StepKind;
  count: number;
  /** Base pence, from each step's own charge (an estimate where only the typical price is known). */
  revenuePence: number;
  /** How many of `count` were counted at their typical price rather than a recorded charge. */
  estimated: number;
}

/** What members paid for the actions the eye started, by type (base pence: before a grant's spend rate). */
export function actionRevenue(steps: readonly StepFact[]): { rows: ActionMoney[]; totalPence: number; estimated: number } {
  const rows = new Map<StepKind, ActionMoney>();
  for (const s of steps) {
    if (!CHARGED_KINDS.has(s.action) || !HAPPENED.has(s.status)) continue;
    const r = rows.get(s.action) ?? { action: s.action, count: 0, revenuePence: 0, estimated: 0 };
    r.count += 1;
    if (s.chargedBasePence === null) {
      r.revenuePence += s.estimateBasePence;
      r.estimated += 1;
    } else r.revenuePence += s.chargedBasePence;
    rows.set(s.action, r);
  }
  const list = STEP_KINDS.filter((k) => rows.has(k)).map((k) => ({ ...rows.get(k)!, revenuePence: round(rows.get(k)!.revenuePence) }));
  return { rows: list, totalPence: round(list.reduce((n, r) => n + r.revenuePence, 0)), estimated: list.reduce((n, r) => n + r.estimated, 0) };
}

export interface TurnMargin {
  turns: number;
  charged: number;
  rawPence: number;
  revenuePence: number;
  marginPence: number;
  marginRate: number | null;
}

/** The AI line of the questions that gave an instruction: our model cost against what members paid for those questions. */
export function turnMargin(instructionIds: ReadonlySet<string>, turns: readonly TurnMoney[]): TurnMargin {
  let raw = 0;
  let revenue = 0;
  let n = 0;
  let charged = 0;
  for (const t of turns) {
    if (!instructionIds.has(t.id)) continue;
    n += 1;
    raw += t.rawPence;
    revenue += t.chargedBasePence;
    if (t.chargedBasePence > 0) charged += 1;
  }
  return { turns: n, charged, rawPence: round(raw), revenuePence: round(revenue), marginPence: round(revenue - raw), marginRate: revenue > 0 ? (revenue - raw) / revenue : null };
}

export interface Safety {
  instructions: number;
  /** Instructions that had something to charge (a spend line was shown). */
  withCharges: number;
  stopsBeforeCharge: number;
  stopsRest: number;
  confirmsShown: { low_balance: number; over_cap: number };
  confirmsYes: { low_balance: number; over_cap: number };
  confirmsNo: { low_balance: number; over_cap: number };
  /** Not enough credit: at the start (nothing charged ran), after a yes, or when a step's turn came. */
  blocked: number;
  memberBugs: number;
  featureRequests: number;
}

/** Stops, confirms shown and accepted, blocked for credit, and the reports the eye filed or offered (counted whether or not the question also planned steps). */
export function safety(instructions: readonly InstructionFact[]): Safety {
  const out: Safety = { instructions: 0, withCharges: 0, stopsBeforeCharge: 0, stopsRest: 0, confirmsShown: { low_balance: 0, over_cap: 0 }, confirmsYes: { low_balance: 0, over_cap: 0 }, confirmsNo: { low_balance: 0, over_cap: 0 }, blocked: 0, memberBugs: 0, featureRequests: 0 };
  for (const i of instructions) {
    if (i.status === 'cancelled') continue;
    if (i.reportKind === 'bug') out.memberBugs += 1;
    if (i.reportKind === 'feature') out.featureRequests += 1;
    if (!i.planned) continue;
    out.instructions += 1;
    if (i.decision !== 'free') out.withCharges += 1;
    if (i.stoppedAt) {
      // A Stop before any charged step was claimed charged nothing; after it, "Stop the rest".
      if (!i.chargedStartedAt || Date.parse(i.stoppedAt) < Date.parse(i.chargedStartedAt)) out.stopsBeforeCharge += 1;
      else out.stopsRest += 1;
    }
    if (i.confirmKind === 'low_balance' || i.confirmKind === 'over_cap') {
      out.confirmsShown[i.confirmKind] += 1;
      if (i.confirmAnswer === 'yes') out.confirmsYes[i.confirmKind] += 1;
      if (i.confirmAnswer === 'no') out.confirmsNo[i.confirmKind] += 1;
    }
    if (i.decision === 'insufficient' || i.ranOutOfCredit) out.blocked += 1;
  }
  return out;
}

export interface Failure {
  action: StepKind;
  code: string;
  count: number;
  autoReported: number;
}

/** Steps that didn't happen because something went wrong (never charged), by action and code, the commonest first. */
export function failures(steps: readonly StepFact[]): { rows: Failure[]; total: number; autoReported: number } {
  const groups = new Map<string, Failure>();
  for (const s of steps) {
    if (s.status !== 'failed') continue;
    const code = s.errorCode ?? 'unknown';
    const k = `${s.action}:${code}`;
    const g = groups.get(k) ?? { action: s.action, code, count: 0, autoReported: 0 };
    g.count += 1;
    if (s.autoReported) g.autoReported += 1;
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.count - a.count || a.action.localeCompare(b.action) || a.code.localeCompare(b.code));
  return { rows, total: rows.reduce((n, r) => n + r.count, 0), autoReported: steps.filter((s) => s.autoReported).length };
}

export interface UndoRate {
  action: StepKind;
  done: number;
  undone: number;
  rate: number | null;
}

/** Of the undoable steps that happened, the share the member undid, by action. */
export function undoRates(steps: readonly StepFact[]): UndoRate[] {
  return STEP_KINDS.filter((k) => UNDOABLE_KINDS.has(k)).map((action) => {
    const mine = steps.filter((s) => s.action === action && HAPPENED.has(s.status));
    const undone = mine.filter((s) => s.undoneAt).length;
    return { action, done: mine.length, undone, rate: mine.length > 0 ? undone / mine.length : null };
  });
}

export interface NextWeek {
  week: string;
  /** Members whose instruction carried something out that week. */
  actors: number;
  /** Of them, weekly active the week after (any qualifying action). */
  activeNext: number;
  /** Full-view chat users that week who gave no instruction that did anything: the comparison. */
  others: number;
  othersActiveNext: number;
}

/**
 * The next-week weekly-active share: of the members the eye did something
 * for in a week, how many were weekly active the week after, beside the
 * full-view users it did nothing for. Only weeks whose next week has begun.
 */
export function nextWeekActive(weeks: readonly string[], actors: ReadonlyMap<string, ReadonlySet<string>>, chatUsers: ReadonlyMap<string, ReadonlySet<string>>, activeByWeek: ReadonlyMap<string, ReadonlySet<string>>, now: Date): NextWeek[] {
  const thisWeek = ukWeekStart(now);
  return weeks
    .filter((w) => addDays(w, 7) <= thisWeek)
    .map((week) => {
      const next = activeByWeek.get(addDays(week, 7)) ?? new Set<string>();
      const did = actors.get(week) ?? new Set<string>();
      const rest = [...(chatUsers.get(week) ?? new Set<string>())].filter((u) => !did.has(u));
      return { week, actors: did.size, activeNext: [...did].filter((u) => next.has(u)).length, others: rest.length, othersActiveNext: rest.filter((u) => next.has(u)).length };
    });
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
