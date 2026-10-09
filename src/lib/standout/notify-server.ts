import 'server-only';

/**
 * Batch 25: telling a member about a standout saved for them. Filled in by
 * the deal-call part of this batch.
 */
export interface NotifyResult {
  considered: number;
  results: { userId: string; dealId: string; outcome: string }[];
}

export async function processNotifications(o: { apply: boolean; now: Date; onlyUserId: string | null }): Promise<NotifyResult> {
  void o;
  return { considered: 0, results: [] };
}

/** Deal calls and their texts go only with STANDOUT_CALLS_ENABLED=true (and Batch 23's SI_CALLS_ENABLED). */
export function dealCallsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STANDOUT_CALLS_ENABLED === 'true';
}
