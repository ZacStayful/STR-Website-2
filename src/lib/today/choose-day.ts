/**
 * Which way a Today list is chosen: tailored (Batch 14, src/lib/tailoring)
 * for a profile with any of the new answers, and exactly as before this
 * batch (choose.ts) for everyone else. choose.test.ts holds the second to a
 * golden record through this function.
 *
 * Pure: no network, no database, no server-only.
 */
import { chooseTodayFrom, type ChooseInput, type ChooseReads, type TodayChoice } from './choose.ts';
import { chooseTailored, type TailoredOptions } from '../tailoring/today.ts';
import { usesTailoring } from '../tailoring/profile.ts';

export interface DayChoice extends TodayChoice {
  /** Tailored: the deals meeting every must-have ("N deals match you"). Null on the untailored path. */
  mustMatches: number | null;
  /** That count reached the pool's read limit. */
  capped: boolean;
}

export async function chooseDay(input: ChooseInput, reads: ChooseReads, opts: TailoredOptions = {}): Promise<DayChoice> {
  if (usesTailoring(input.tailoring)) return chooseTailored(input, input.tailoring, reads, opts);
  return { ...(await chooseTodayFrom(input, reads)), mustMatches: null, capped: false };
}
