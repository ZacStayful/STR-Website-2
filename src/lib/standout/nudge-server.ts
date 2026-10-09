import 'server-only';

/**
 * Batch 25, Part C: the slower-spender nudge. Filled in by Part C.
 */
export interface NudgeRunResult {
  due: number;
  results: { userId: string; outcome: string }[];
}

export async function processNudges(o: { apply: boolean; now: Date; onlyUserId: string | null }): Promise<NudgeRunResult> {
  void o;
  return { due: 0, results: [] };
}
