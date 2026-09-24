/**
 * Where a lead sits in its own lifecycle.
 *
 * Pure module (no I/O, no `server-only`, relative `.ts` imports) so it runs
 * under `node --test` — the same split as windows.ts / caps.ts. The half that
 * talks to Postgres is store.ts, which re-exports these.
 */

// 'queued'   captured, report not run yet (the customer had no credit)
// 'new'      report ran, nothing done with it yet
// 'pushed'   delivered to the customer's CRM
// 'held'     failed the filter on a 'hold' funnel; kept for review
// 'exported' pulled out via the API or a CSV download
export type LeadStatus = 'queued' | 'new' | 'pushed' | 'held' | 'exported';

/**
 * Where a lead lands once its report has run.
 *
 * A 'hold' funnel keeps a lead that missed the filter back for its owner to
 * review; 'crm_flagged' sends it on, marked. Either way it leaves `queued`,
 * and that is the load-bearing part rather than a detail: `queued` is what the
 * drain cron reads as "the report has not run yet", and it acts on that by
 * running it. So a lead that HAS run must never keep that status, or it is
 * analysed a second time and the customer is charged a second time.
 *
 * Extracted from an inline ternary so that the full write in `completeLead` and
 * the status-only fallback behind it cannot pick different answers — and so
 * this invariant is pinned by a test.
 */
export function completedLeadStatus(
  qualified: boolean,
  unqualifiedPolicy: 'crm_flagged' | 'hold',
): LeadStatus {
  if (qualified) return 'new';
  return unqualifiedPolicy === 'hold' ? 'held' : 'new';
}
