/**
 * Batch 21 (C3, D10): the two windows the lead store keys on.
 *
 *   - A prospect who submits the same funnel for the same property with the
 *     same email inside REUSE_WINDOW_MS is the same enquiry: the first lead is
 *     reused (its report resent if it ran, run once if it is still queued),
 *     never a second lead and a second charge.
 *   - A queued lead is claimed with a lease before its report is run, so two
 *     drains (or the funnel and the drain) cannot both run and charge it. A
 *     lease is `updated_at` moved to now; a lead touched inside
 *     QUEUED_LEASE_MS is left alone, which also covers a run killed mid-way.
 *
 * Pure: no network, no database, no server-only.
 */

export const REUSE_WINDOW_MS = 60 * 60 * 1000;
export const QUEUED_LEASE_MS = 5 * 60 * 1000;

/** Leads created at or after this are candidates for reuse. */
export function reuseSince(now: Date): string {
  return new Date(now.getTime() - REUSE_WINDOW_MS).toISOString();
}

/** A queued lead last touched before this may be claimed. */
export function leaseCutoff(now: Date): string {
  return new Date(now.getTime() - QUEUED_LEASE_MS).toISOString();
}
