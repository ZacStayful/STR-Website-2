/**
 * Batch 22e: the rules behind Home's figures, kept apart from the reads so
 * they are tested rather than trusted. See types.ts for what each one means.
 *
 * Pure: no network, no database, no server-only.
 */
import { PIPELINE_STATUSES, type PipelineStatus } from '../listing/pipeline.ts';
import { TODAY_SIZE, displayOrder, isDone, tally } from '../today/day.ts';
import { timeSavedMinutes } from './config.ts';
import type { AnalysesFigure, SavedStage, ScannedFigure, StageCounts, Tile, TimeSavedFigure, TodayFigure } from './types.ts';

/** A tile's read, settled: a failure (or a throw) is `{ ok: false }`, never a broken page. */
export async function settle<T>(read: () => Promise<T>): Promise<Tile<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    console.warn('[home] tile failed:', err instanceof Error ? err.message : String(err));
    return { ok: false };
  }
}

// ── Today's 5 ──

/** The day's cards the way Today orders them (the pick first), and where the member is with them. */
export function todayFigure(input: { day: string; stored: readonly string[] | null; pickDealId: string | null; answers: ReadonlyMap<string, 'keep' | 'pass'>; paused: boolean; profileName: string | null }): TodayFigure {
  const base = { day: input.day, paused: input.paused, profileName: input.profileName };
  if (input.paused) return { ...base, size: 0, waiting: 0, kept: 0, passed: 0, done: false, ready: false };
  const stored = input.stored ?? [];
  const ready = input.stored !== null || input.pickDealId !== null;
  const order = displayOrder(stored, input.pickDealId, new Set(input.answers.keys()), TODAY_SIZE);
  const t = tally(order, input.answers);
  return { ...base, size: order.length, waiting: order.length - t.kept - t.passed, kept: t.kept, passed: t.passed, done: isDone(order, input.answers), ready };
}

// ── Deals picked for you ──

export interface PickedList {
  profileId: string | null;
  /** When the list was made (created_at), for the Start again cutoff. */
  at: string | null;
  dealIds: readonly string[];
}

/**
 * Distinct deals picked for the member: every Today list (per profile and the
 * older per-member ones) and the signup reveal. For the active profile, only
 * its own lists made after its latest Start again.
 */
export function pickedCounts(lists: readonly PickedList[], activeProfileId: string | null, restartAt: string | null): { active: number | null; all: number } {
  const all = new Set<string>();
  const active = new Set<string>();
  const cutoff = restartAt ? Date.parse(restartAt) : Number.NEGATIVE_INFINITY;
  for (const l of lists) {
    for (const id of l.dealIds) all.add(id);
    if (activeProfileId && l.profileId === activeProfileId) {
      const at = l.at ? Date.parse(l.at) : Number.NaN;
      if (!Number.isFinite(cutoff) || (Number.isFinite(at) && at >= cutoff)) for (const id of l.dealIds) active.add(id);
    }
  }
  return { active: activeProfileId ? active.size : null, all: all.size };
}

// ── Saved deals ──

/** How Home reads My deals: the member's own entries, without the ones Start again (Batch 22d) cleared. */
export const SAVED_DEALS_READ = { scope: 'own', hidden: 'exclude' } as const;

export const SAVED_STAGES: readonly SavedStage[] = PIPELINE_STATUSES.map((s) => s.key).filter((k): k is SavedStage => k !== 'passed');

export function emptyStages(): StageCounts {
  return { watching: 0, contacted: 0, viewing: 0, offer: 0, secured: 0 };
}

/** Kept → Secured counts (Passed left out). `onlyProfile`: just the entries tagged to that profile, as My deals' ?profile= shows them. */
export function savedStageCounts(view: readonly { key: string; stage: PipelineStatus }[], tags?: ReadonlyMap<string, string>, onlyProfile?: string | null): StageCounts {
  const out = emptyStages();
  for (const v of view) {
    if (v.stage === 'passed') continue;
    if (onlyProfile && tags?.get(v.key) !== onlyProfile) continue;
    out[v.stage] += 1;
  }
  return out;
}

export function stageTotal(c: StageCounts): number {
  return SAVED_STAGES.reduce((n, s) => n + c[s], 0);
}

// ── Analyses and time saved ──

export function analysesFigure(parts: { reports: number; deepAnalyses: number; quickLooks: number }): AnalysesFigure {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return { full: n(parts.reports) + n(parts.deepAnalyses), quick: n(parts.quickLooks) };
}

/** Needs both halves: if either tile failed, so does this one (never a figure missing a part). */
export function timeSavedFigure(scanned: Tile<ScannedFigure>, analyses: Tile<AnalysesFigure>): Tile<TimeSavedFigure> {
  if (!scanned.ok || !analyses.ok) return { ok: false };
  return { ok: true, value: { minutes: timeSavedMinutes(scanned.value.total, analyses.value.full), scanned: scanned.value.total, fullAnalyses: analyses.value.full } };
}

// ── Total spent ──

/** Credit used: debits less refunds, in pence; never below 0. */
export function spentPence(lines: readonly { kind: 'debit' | 'refund'; facePence: number }[]): number {
  let p = 0;
  for (const l of lines) {
    const v = Number.isFinite(l.facePence) ? Math.abs(l.facePence) : 0;
    p += l.kind === 'refund' ? -v : v;
  }
  return Math.max(0, Math.round(p));
}
