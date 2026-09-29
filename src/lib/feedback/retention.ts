import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { RETENTION_BATCH, RETENTION_EMAIL_FAILURES_MAX, RETENTION_TIME_BUDGET_MS } from './config';
import { isSchemaMissing, screenshotCutoff } from './rules';
import { sendAdminReportEmail, unsentAdminEmails } from './server';
import { feedbackSettings } from './settings-server';
import { removeScreenshots } from './storage';

/**
 * The daily feedback run (Batch 18; /api/internal/feedback-retention):
 *
 *   1. Admin emails: a report whose email to the admin address never went
 *      (Resend was down, or not set up) is sent now, if it is between 10
 *      minutes and 3 days old. Each is keyed at Resend and stamped, so it
 *      never goes twice.
 *   2. Expired screenshots: images older than the retention setting are
 *      removed from the bucket. Their rows stay, stamped deleted_at, so admin
 *      can say the image was deleted.
 *   3. Orphaned screenshots: images whose report has gone (the member's
 *      account was deleted) are removed, and so are their rows.
 *
 * A row is stamped or deleted only after the bucket confirms its images are
 * gone, so a removal that fails is tried again the next night. Nothing new is
 * started after RETENTION_TIME_BUDGET_MS; the rest waits for the next night.
 * `apply: false` counts what would be done and changes nothing.
 */

export interface FeedbackRetentionResult {
  dry: boolean;
  /** The Batch 18 section of supabase/schema.sql has not been run: nothing to do. */
  schemaMissing: boolean;
  retentionDays: number;
  /** Screenshots stored before this are due for deletion. */
  cutoff: string;
  adminEmails: { due: number; sent: number; failed: number };
  screenshots: {
    /** Images past the retention period, still in the bucket. */
    expired: number;
    /** Rows whose report has gone (their images are removed with them). */
    orphaned: number;
    /** Images removed from the bucket by this run. */
    removed: number;
    /** When the oldest image still in the bucket was sent. */
    oldestStored: string | null;
  };
  /** False when the run stopped at its time budget or on an error: the rest is done next time. */
  finished: boolean;
  errors: string[];
}

type Admin = ReturnType<typeof createAdminClient>;
type Sweep = 'expired' | 'orphaned';

export async function runFeedbackRetention({ apply, now = new Date() }: { apply: boolean; now?: Date }): Promise<{ ok: true; result: FeedbackRetentionResult } | { ok: false; message: string }> {
  if (!hasServiceRole()) return { ok: false, message: 'service role not configured' };
  const started = Date.now();
  const inTime = () => Date.now() - started < RETENTION_TIME_BUDGET_MS;
  const settings = await feedbackSettings();
  const cutoff = screenshotCutoff(now, settings.retentionDays).toISOString();
  const admin = createAdminClient();
  const result: FeedbackRetentionResult = {
    dry: !apply,
    schemaMissing: false,
    retentionDays: settings.retentionDays,
    cutoff,
    adminEmails: { due: 0, sent: 0, failed: 0 },
    screenshots: { expired: 0, orphaned: 0, removed: 0, oldestStored: null },
    finished: true,
    errors: [],
  };

  // What is due, for the summary (and all a dry run does).
  const [expired, orphaned, oldest] = await Promise.all([
    admin.from('feedback_screenshots').select('id', { count: 'exact', head: true }).is('deleted_at', null).not('report_id', 'is', null).lt('created_at', cutoff),
    admin.from('feedback_screenshots').select('id', { count: 'exact', head: true }).is('report_id', null),
    admin.from('feedback_screenshots').select('created_at').is('deleted_at', null).order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const readError = expired.error ?? orphaned.error ?? oldest.error;
  if (readError) {
    if (isSchemaMissing(readError)) return { ok: true, result: { ...result, schemaMissing: true } };
    return { ok: false, message: readError.message };
  }
  result.screenshots.expired = expired.count ?? 0;
  result.screenshots.orphaned = orphaned.count ?? 0;
  result.screenshots.oldestStored = (oldest.data as { created_at?: string } | null)?.created_at ?? null;

  // 1. Admin emails that never went.
  const due = await unsentAdminEmails(now);
  result.adminEmails.due = due.length;
  if (apply) {
    let failedInRow = 0;
    for (const report of due) {
      if (!inTime()) {
        result.finished = false;
        break;
      }
      const sent = await sendAdminReportEmail(report.id);
      if (sent.sent) {
        result.adminEmails.sent += 1;
        failedInRow = 0;
        continue;
      }
      result.adminEmails.failed += 1;
      failedInRow += 1;
      result.errors.push(`admin email #${report.ref}: ${sent.reason ?? 'not sent'}`);
      // Not set up, or down: the rest would fail the same way. Tomorrow.
      if (sent.reason === 'not_configured' || failedInRow >= RETENTION_EMAIL_FAILURES_MAX) {
        result.finished = false;
        break;
      }
    }
  }

  // 2 and 3. Screenshots.
  if (apply) {
    for (const sweep of ['expired', 'orphaned'] as const) {
      if (result.screenshots[sweep] === 0) continue;
      const done = await sweepScreenshots(admin, sweep, cutoff, now, inTime, result);
      if (!done) {
        result.finished = false;
        break;
      }
    }
  }

  return { ok: true, result };
}

/** Removes one kind of screenshot, a batch at a time. True when none is left; false when it stopped early. */
async function sweepScreenshots(admin: Admin, sweep: Sweep, cutoff: string, now: Date, inTime: () => boolean, result: FeedbackRetentionResult): Promise<boolean> {
  while (inTime()) {
    const base = admin.from('feedback_screenshots').select('id, path, deleted_at');
    const query = sweep === 'expired' ? base.is('deleted_at', null).not('report_id', 'is', null).lt('created_at', cutoff) : base.is('report_id', null);
    const { data, error } = await query.order('created_at', { ascending: true }).limit(RETENTION_BATCH);
    if (error) {
      result.errors.push(`${sweep} screenshots: ${error.message}`);
      return false;
    }
    const rows = (data ?? []) as { id: string; path: string; deleted_at: string | null }[];
    if (rows.length === 0) return true;

    // An orphan's image may have gone already (deleted after the retention
    // period, before its report did); only the rest need removing.
    const paths = rows.filter((r) => !r.deleted_at).map((r) => r.path);
    const removed = await removeScreenshots(paths);
    if (!removed.ok) {
      result.errors.push(`${sweep} screenshots: ${removed.error ?? 'remove failed'}`);
      return false;
    }
    result.screenshots.removed += paths.length;

    const ids = rows.map((r) => r.id);
    const { error: markError } =
      sweep === 'expired'
        ? await admin.from('feedback_screenshots').update({ deleted_at: now.toISOString() }).in('id', ids).is('deleted_at', null)
        : await admin.from('feedback_screenshots').delete().in('id', ids).is('report_id', null);
    if (markError) {
      // The images are gone; the rows are tried again next time (removing
      // an image that has already gone is harmless).
      result.errors.push(`${sweep} screenshots: removed but not recorded: ${markError.message}`);
      return false;
    }
    if (rows.length < RETENTION_BATCH) return true;
  }
  return false;
}
