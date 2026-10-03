import 'server-only';

/**
 * Batch 24: the Monday email (src/lib/knowledge/weekly.ts) to the admin
 * address. Run by the nightly job on UK Mondays, and by
 * /api/internal/si-knowledge?step=weekly (with `&dry=1`: the email it
 * would send, sent to nobody, nothing claimed).
 *
 * Once a week: si_gap_claim('weekly', the reported week's Monday), and
 * Resend's idempotency key si-gaps:<week> as well. It is an admin email, so
 * it goes straight through sendEmail, outside the members' one-a-day cap,
 * and it is nobody's activity.
 */
import { createAdminClient } from '../supabase/admin';
import { sendEmail } from '../email/send';
import { siteUrl } from '../url';
import { feedbackSettings } from '../feedback/settings-server';
import { addDays, ukWeekRange, ukWeekStart } from '../activity/week';
import { RUN_STALE_CLAIM_MS, WEEKLY_TOP_GAPS } from './config';
import { coverageFor, topGaps } from './coverage-server';
import { weeklyGapEmail } from './weekly';

type Admin = ReturnType<typeof createAdminClient>;

export interface WeeklyResult {
  status: 'sent' | 'dry' | 'skipped' | 'failed';
  /** The Monday of the week reported on. */
  week: string;
  to?: string;
  subject?: string;
  text?: string;
  reason?: string;
}

export async function runWeeklyGapEmail(o: { dry: boolean; now?: Date; triggeredBy: string }, admin: Admin = createAdminClient()): Promise<WeeklyResult> {
  const now = o.now ?? new Date();
  const week = addDays(ukWeekStart(now), -7);
  const before = addDays(week, -7);
  const { start, end } = ukWeekRange(week);

  let runId: string | null = null;
  if (!o.dry) {
    const { data, error } = await admin.rpc('si_gap_claim', { p: { kind: 'weekly', run_key: week, stale_ms: RUN_STALE_CLAIM_MS } });
    if (error) return { status: 'failed', week, reason: error.message };
    runId = (data as { id: string | null }).id;
    if (!runId) return { status: 'skipped', week, reason: 'already sent for this week' };
  }
  const finish = async (status: 'done' | 'failed', report: Record<string, unknown>) => {
    if (runId) await admin.from('si_gap_runs').update({ status, finished_at: new Date().toISOString(), report: { ...report, triggeredBy: o.triggeredBy } }).eq('id', runId);
  };

  try {
    const [coverage, top, fresh, waiting, settings] = await Promise.all([
      coverageFor(admin, [before, week]),
      topGaps(admin, { limit: WEEKLY_TOP_GAPS, since: start.toISOString(), until: end.toISOString() }),
      admin.from('si_knowledge_gaps').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()).lt('created_at', end.toISOString()),
      admin.from('si_knowledge').select('id', { count: 'exact', head: true }).eq('draft_state', 'pending').is('retired_at', null),
      feedbackSettings(),
    ]);
    if (!coverage || !top || fresh.error || waiting.error) throw new Error("the gaps or the conversation log can't be read");
    const mail = weeklyGapEmail({
      week,
      newGaps: fresh.count ?? 0,
      topGaps: top,
      waitingDrafts: waiting.count ?? 0,
      weekBefore: coverage[0]?.total ?? null,
      lastWeek: coverage[1]?.total ?? null,
      gapsUrl: siteUrl('/admin/intelligence/gaps'),
      coverageUrl: siteUrl('/admin/intelligence/coverage'),
    });
    const to = settings.adminEmail;
    if (o.dry) return { status: 'dry', week, to, subject: mail.subject, text: mail.text };
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `si-gaps:${week}` });
    // 409: Resend already has this week's email under the key (sent before the run row was closed).
    if (!res.sent && res.reason !== 'http_409') {
      await finish('failed', { error: `not sent: ${res.reason ?? 'unknown'}` });
      return { status: 'failed', week, reason: res.reason ?? 'not sent' };
    }
    await finish('done', { sent: true });
    return { status: 'sent', week, to, subject: mail.subject };
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error('[knowledge] weekly email failed:', message);
    await finish('failed', { error: message });
    return { status: 'failed', week, reason: message };
  }
}
