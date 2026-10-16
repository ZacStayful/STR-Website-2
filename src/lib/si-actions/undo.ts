/**
 * Batch 27: Undo's rules (Zac, 29 Sep: 24 hours, from the chat line or My
 * deals, for Keep/Pass, stage moves and profile changes; charges are never
 * undone).
 *
 * A step is put back only when what it changed is still as it left it. If
 * the member (or anything else) has changed it since, that step is left
 * alone and the eye says so: Undo never overwrites a later change.
 *
 * Pure: no network, no database, no server-only.
 */
import type { PipelineStatus } from '../listing/pipeline.ts';
import { UNDOABLE_KINDS, type StepKind, type StepStatus } from './config.ts';

/** Where a deal stood: its My deals stage (null: not there) and the member's own Keep / Pass. */
export interface StageState {
  stage: PipelineStatus | null;
  reaction: 'keep' | 'pass' | null;
  /** The member's own pipeline row for it, when there is one. */
  checkedListingId: string | null;
}

export interface UndoableStep {
  kind: StepKind;
  status: StepStatus;
  finishedAt: string | null;
  undoneAt: string | null;
}

/** Whether a step can still be undone: done, an undoable kind, not undone already, inside the window. */
export function undoOpen(step: UndoableStep, now: Date, undoHours: number): boolean {
  if (!UNDOABLE_KINDS.has(step.kind) || step.status !== 'done' || step.undoneAt) return false;
  const at = step.finishedAt ? Date.parse(step.finishedAt) : Number.NaN;
  return Number.isFinite(at) && now.getTime() - at <= undoHours * 60 * 60 * 1000;
}

/** When the Undo button goes (the latest finish among the steps, plus the window). */
export function undoUntil(finishedAt: readonly (string | null)[], undoHours: number): string | null {
  const times = finishedAt.map((t) => (t ? Date.parse(t) : Number.NaN)).filter((t) => Number.isFinite(t));
  if (times.length === 0) return null;
  return new Date(Math.max(...times) + undoHours * 60 * 60 * 1000).toISOString();
}

/** A stage step is still as it left it. */
export function stageUnchanged(current: StageState, after: StageState): boolean {
  return current.stage === after.stage && current.reaction === after.reaction;
}

/**
 * How a stage step is put back:
 *   'stage'          set the stage it was at (setStageForMember)
 *   'clear'          it wasn't in My deals: take back the Keep / Pass (setDealReaction null)
 *   'clear_and_row'  as 'clear', and remove the pipeline row the step made (it had none before)
 */
export function stageRestore(before: StageState, after: StageState): 'stage' | 'clear' | 'clear_and_row' {
  if (before.stage !== null) return 'stage';
  return after.checkedListingId && !before.checkedListingId ? 'clear_and_row' : 'clear';
}

/** Two stored answers are the same (key order doesn't matter). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(',')}}`;
}

/** What Undo did, in one line: "Put back 4 of 4", "Put back 3 — 1 had changed since, so I left it". */
export function undoLine(r: { undone: number; changed: number; failed: number }): string {
  const total = r.undone + r.changed + r.failed;
  if (total === 0) return 'There was nothing to undo.';
  if (r.undone === 0) return r.changed > 0 ? 'Nothing put back: it has changed since, so I left it.' : 'I couldn’t put that back just now. Please try again.';
  const head = r.undone === total ? (total === 1 ? 'Done — put back.' : `Done — put all ${total} back.`) : `Put back ${r.undone} of ${total}.`;
  const notes: string[] = [];
  if (r.changed > 0) notes.push(`${r.changed} had changed since, so I left ${r.changed === 1 ? 'it' : 'them'}`);
  if (r.failed > 0) notes.push(`${r.failed} couldn’t be put back`);
  return notes.length > 0 ? `${head} ${notes.join('; ')}.` : head;
}
