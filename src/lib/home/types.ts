/**
 * Batch 22e: Home's figures. Every number is read from a table and can be
 * traced back to it; a tile that cannot be read is `{ ok: false }` and shows
 * "—", the rest still render. Batches 23b (the briefing) and 26 reuse these.
 *
 * Pure types: no network, no database, no server-only.
 */
import type { PipelineStatus } from '../listing/pipeline.ts';

export type Tile<T> = { ok: true; value: T } | { ok: false };

export type SavedStage = Exclude<PipelineStatus, 'passed'>;
export type StageCounts = Record<SavedStage, number>;

/** Today's 5 for the active profile, read back (never chosen here). */
export interface TodayFigure {
  /** The Today-day (07:00 UTC turnover). */
  day: string;
  /** Cards on today's list (at most 5); 0 before the day's list exists. */
  size: number;
  waiting: number;
  kept: number;
  passed: number;
  done: boolean;
  /** The day's list exists yet. */
  ready: boolean;
  /** The active profile is paused: no daily deals. */
  paused: boolean;
  profileName: string | null;
}

export interface ScannedFigure {
  total: number;
  /** Live in the member's areas when they joined (or the reveal's checked count, if more). */
  baseline: number;
  /** First screened in their areas after the day they joined. */
  newSince: number;
  /** The UK day they joined. */
  joinDay: string;
  /** The first day anything was recorded, when that is after they joined: "counted from …". */
  countedFrom: string | null;
  /** Every area (anywhere / near me + the best elsewhere), or how many. */
  areas: number | 'all';
}

export interface AnalysesFigure {
  /** Analyser reports + full deal analyses: what the 30 minutes each counts. */
  full: number;
  /** Quick looks the member opened themselves (never the automatic daily-pick opens). */
  quick: number;
}

export interface TimeSavedFigure {
  minutes: number;
  scanned: number;
  fullAnalyses: number;
}

export interface PickedFigure {
  /** Distinct deals picked for the active profile since its latest Start again. */
  active: number | null;
  /** Distinct deals picked for the member on any profile, ever. */
  all: number;
}

export interface SavedFigure {
  /** Stage counts for the active profile's deals; null with one profile (it is the same as `all`). */
  active: StageCounts | null;
  all: StageCounts;
  activeProfileId: string | null;
}

export interface SpentFigure {
  /** Credit used since joining, in pence (debits less refunds). */
  pence: number;
}

export interface FeedItem {
  /** For ordering: newest first. */
  at: string;
  text: string;
  href: string;
  /** What a tap is logged as (home_feed_tap extras.target). */
  target: string;
}

export interface HomeFigures {
  today: Tile<TodayFigure>;
  scanned: Tile<ScannedFigure>;
  timeSaved: Tile<TimeSavedFigure>;
  picked: Tile<PickedFigure>;
  saved: Tile<SavedFigure>;
  analyses: Tile<AnalysesFigure>;
  /** Null: not shown (a team member: credit is the owner's). */
  spent: Tile<SpentFigure> | null;
  feed: Tile<FeedItem[]>;
}
