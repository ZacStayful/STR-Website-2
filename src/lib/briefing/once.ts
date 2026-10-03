/**
 * Batch 23b: the two rules that make a briefing happen once per member per
 * UK day, whatever retries, overlapping runs or crashes do.
 *
 *   claim   the (member, UK day) row is the lock. No row: take it. A finished
 *           row, or one a live run is still writing: leave it. A row left
 *           'generating' by a run that died (older than STALE_MS): take it
 *           over, KEEPING its action id.
 *   charge  before charging, the ledger is read by that action id: anything
 *           already charged under it is never charged again. So a run that
 *           died between the charge and the row update, then reclaimed, finds
 *           its own charge and stops.
 *
 * Pure: no network, no database, no server-only.
 */

export const STALE_MS = 5 * 60 * 1000;

export interface ExistingRow {
  status: string;
  createdAt: string;
  actionId: string | null;
}

export type ClaimDecision = { kind: 'insert' } | { kind: 'reclaim'; actionId: string | null } | { kind: 'busy' };

export function claimDecision(existing: ExistingRow | null, now: Date): ClaimDecision {
  if (!existing) return { kind: 'insert' };
  if (existing.status !== 'generating') return { kind: 'busy' };
  if (Date.parse(existing.createdAt) > now.getTime() - STALE_MS) return { kind: 'busy' };
  return { kind: 'reclaim', actionId: existing.actionId };
}

/** Charge only when nothing is on the ledger under this action id yet. */
export function shouldCharge(alreadyBasePence: number): boolean {
  return !(alreadyBasePence > 0);
}
