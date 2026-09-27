import 'server-only';

/**
 * One full report at a time per pipeline row (checked_listings), so a double
 * click, a second tab or a refresh cannot start, and charge, a second report
 * for the same listing while the first is running.
 *
 * The claim is one conditional UPDATE on checked_listings.report_started_at:
 * it only matches while nothing is running (null, or a claim older than
 * CLAIM_STALE_MS, which no run outlives: the route's limit is 60 seconds).
 * Postgres locks the row for the first writer; the second re-checks the
 * condition against the committed claim and matches nothing. It is taken
 * before any credit is reserved, and released when the run ends.
 *
 * `fromDeal` (the Full report button on a deal) also refuses a second report
 * for a row that already has one, and hands back its id instead: the deal
 * shows "Open full report" from then on, so a stale tab cannot pay again.
 * The same goes for a report a teammate already has on the deal: the deal
 * page offers theirs rather than the button, and the server holds to it, in
 * the same team scope (src/lib/listing/tracked-server.ts).
 *
 * If the column is missing (schema.sql not run yet) the claim is skipped and
 * the report runs exactly as before: reports never go down over this.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { beforeJoining, trackedScope } from '../listing/tracked-server';

export const CLAIM_STALE_MS = 3 * 60 * 1000;

export type ClaimOutcome =
  /** The run is ours; release it when done. */
  | { kind: 'claimed' }
  /** The row is not this person's: run without linking to it. */
  | { kind: 'not_own' }
  /** A report for this row is already running. */
  | { kind: 'running' }
  /** A deal's report already exists (fromDeal only). */
  | { kind: 'reported'; reportId: string }
  /** No claim possible (schema behind, no service role): run as before. */
  | { kind: 'unavailable' };

export async function claimReportRun(userId: string, checkedListingId: string, opts: { fromDeal: boolean }, now: Date = new Date()): Promise<ClaimOutcome> {
  if (!hasServiceRole()) return { kind: 'unavailable' };
  const admin = createAdminClient();
  const { data: row, error } = await admin.from('checked_listings').select('id, canonical_url, analysed_report_id').eq('id', checkedListingId).eq('user_id', userId).maybeSingle();
  if (error) {
    console.warn('[report-claim] row read failed:', error.message);
    return { kind: 'unavailable' };
  }
  if (!row) return { kind: 'not_own' };
  const reportId = typeof row.analysed_report_id === 'string' ? row.analysed_report_id : null;
  if (opts.fromDeal && reportId) {
    const { data: report } = await admin.from('saved_searches').select('id').eq('id', reportId).maybeSingle();
    if (report) return { kind: 'reported', reportId };
  }
  if (opts.fromDeal && typeof row.canonical_url === 'string') {
    const teamReportId = await teamReportFor(admin, userId, row.canonical_url);
    if (teamReportId) return { kind: 'reported', reportId: teamReportId };
  }
  const stale = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from('checked_listings')
    .update({ report_started_at: now.toISOString() })
    .eq('id', checkedListingId)
    .eq('user_id', userId)
    .or(`report_started_at.is.null,report_started_at.lt.${stale}`)
    .select('id');
  if (claimErr) {
    console.warn('[report-claim] claim failed (schema behind?):', claimErr.message);
    return { kind: 'unavailable' };
  }
  return (claimed ?? []).length > 0 ? { kind: 'claimed' } : { kind: 'running' };
}

/**
 * A report a teammate already has on this deal, as the deal page shows it:
 * the team scope of My deals (active members and the owner; a teammate's rows
 * from before they joined stay theirs alone), newest first, still saved, and
 * one this person can open (saved_searches' RLS: the report's owner_id is
 * them or their team's owner). A report they could not open is never offered
 * in place of running their own.
 * Null when there is none, or it cannot be read (the run then goes ahead as
 * it did before).
 */
async function teamReportFor(admin: ReturnType<typeof createAdminClient>, userId: string, canonicalUrl: string): Promise<string | null> {
  try {
    const scope = await trackedScope(userId, 'team');
    const others = scope.people.filter((id) => id !== userId);
    if (others.length === 0) return null;
    const { data: rows, error } = await admin
      .from('checked_listings')
      .select('user_id, analysed_report_id, created_at')
      .in('user_id', others)
      .eq('canonical_url', canonicalUrl)
      .not('analysed_report_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn('[report-claim] team read failed:', error.message);
      return null;
    }
    const ids = ((rows ?? []) as { user_id: string; analysed_report_id: string | null; created_at: string | null }[])
      .filter((r) => typeof r.analysed_report_id === 'string' && !beforeJoining(scope, userId, r.user_id, r.created_at))
      .map((r) => r.analysed_report_id as string);
    if (ids.length === 0) return null;
    const readable = new Set([userId, scope.payerId]);
    const { data: saved } = await admin.from('saved_searches').select('id, owner_id').in('id', ids);
    const present = new Set(((saved ?? []) as { id: string; owner_id: string | null }[]).filter((r) => r.owner_id !== null && readable.has(r.owner_id)).map((r) => r.id));
    return ids.find((id) => present.has(id)) ?? null;
  } catch (err) {
    console.warn('[report-claim] team report check failed:', err);
    return null;
  }
}

/** Ends a claim. Never throws. */
export async function releaseReportRun(userId: string, checkedListingId: string): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const { error } = await createAdminClient().from('checked_listings').update({ report_started_at: null }).eq('id', checkedListingId).eq('user_id', userId);
    if (error) console.warn('[report-claim] release failed:', error.message);
  } catch (err) {
    console.warn('[report-claim] release threw:', err);
  }
}
