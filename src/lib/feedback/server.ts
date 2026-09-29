import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sendEmail } from '../email/send';
import { safeReplyTo } from '../email/from';
import { adminReportEmail } from '../email/feedback';
import { payerFor, teamOf } from '../team';
import { ACCESS_COLUMNS, accountStatus, planName } from '../access';
import { activeProfileIdOf } from '../profiles/server';
import { siteUrl } from '../url';
import { ADMIN_EMAIL_RETRY_AFTER_MINUTES, ADMIN_EMAIL_RETRY_WITHIN_DAYS, MEMBER_LIST_MAX, type FeedbackSettings, type ReportKind, type ReportStatus } from './config';
import {
  MEMBER_REPORT_COLUMNS,
  cleanHeader,
  deviceSummary,
  isSchemaMissing,
  planLine,
  planShort,
  screenLine,
  shortBuild,
  ukDayStart,
  versionLine,
  type ClientContext,
  type ReportContext,
  type ScreenshotType,
} from './rules';
import { feedbackSettings } from './settings-server';
import { screenshotPath, uploadScreenshot } from './storage';

/**
 * Batch 18's feedback on the server: sending a report, and the email to the
 * admin address. Everything goes through the service role: the tables are
 * closed to members (supabase/schema.sql), and whose report it is always
 * comes from the session, never from the request. Nothing here charges.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Why a send was refused, for the route to answer with. */
export type SubmitRefusal = { ok: false; status: number; error: 'limit' | 'unavailable' | 'failed'; limit?: number };

export type SubmitOutcome = { ok: true; id: string; ref: number; attached: number; failed: number; duplicate: boolean } | SubmitRefusal;

/**
 * Who sent it, as admin needs to know: their email, the plan of whoever pays
 * (a team member's owner), whether they are on a team, their active profile.
 * Every part is best-effort: a lookup that fails leaves its part empty and
 * the report still goes.
 */
export async function memberContext(admin: Admin, userId: string, email: string | null): Promise<Pick<ReportContext, 'email' | 'plan' | 'team' | 'activeProfileId'>> {
  const team = await teamOf(userId).catch(() => ({ ownerId: userId, role: 'owner' as const, suspended: false }));
  const payer = await payerFor(userId).catch(() => ({ payerId: userId, memberId: null, suspended: false }));
  const member = team.role === 'member';
  const [payerRow, ownerRow, activeProfileId] = await Promise.all([
    admin.from('profiles').select(ACCESS_COLUMNS).eq('id', payer.payerId).maybeSingle(),
    member ? admin.from('profiles').select('email').eq('id', team.ownerId).maybeSingle() : Promise.resolve({ data: null }),
    member ? Promise.resolve(null) : activeProfileIdOf(userId).catch(() => null),
  ]);
  const account = (payerRow.data ?? null) as Record<string, unknown> | null;
  const code = typeof account?.plan_code === 'string' ? account.plan_code : null;
  return {
    email,
    plan: { code, name: planName(code), status: account ? accountStatus(account) : 'unknown' },
    team: { member, ownerId: member ? team.ownerId : null, ownerEmail: member ? ((ownerRow.data as { email?: string | null } | null)?.email ?? null) : null },
    activeProfileId,
  };
}

/** Reports this member has sent since UK midnight, and how many they have left; null when it cannot be read. */
export async function remainingToday(userId: string, limit: number, now = new Date()): Promise<number | null> {
  if (!hasServiceRole()) return null;
  const { count, error } = await createAdminClient()
    .from('feedback_reports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', ukDayStart(now).toISOString());
  if (error) {
    if (!isSchemaMissing(error)) console.error('[feedback] could not count today’s reports:', error.message);
    return null;
  }
  return Math.max(0, limit - (count ?? 0));
}

export interface SubmitInput {
  userId: string;
  email: string | null;
  kind: ReportKind;
  body: string;
  clientKey: string;
  client: ClientContext;
  userAgent: string | null;
  files: { bytes: Uint8Array; type: ScreenshotType }[];
  settings: FeedbackSettings;
}

/**
 * Sends a report: the retry check and the daily limit in one step
 * (feedback_submit), then each screenshot. An image's row is written before
 * its upload and removed if the upload fails, so a stored image always has
 * its row; a failed image never loses the report. A retry of a report that
 * was already sent comes back as it, with nothing uploaded twice.
 */
export async function submitReport(input: SubmitInput): Promise<SubmitOutcome> {
  if (!hasServiceRole()) return { ok: false, status: 503, error: 'unavailable' };
  const admin = createAdminClient();
  const who = await memberContext(admin, input.userId, input.email);
  const userAgent = cleanHeader(input.userAgent);
  const context: ReportContext = {
    ...input.client,
    device: deviceSummary(userAgent, input.client.touch),
    userAgent,
    serverBuild: shortBuild(process.env.VERCEL_GIT_COMMIT_SHA),
    env: process.env.VERCEL_ENV ?? null,
    ...who,
  };
  const { data, error } = await admin.rpc('feedback_submit', {
    p: { user: input.userId, kind: input.kind, body: input.body, context, client_key: input.clientKey, limit: input.settings.dailyLimit },
  });
  if (error) {
    if (isSchemaMissing(error)) return { ok: false, status: 503, error: 'unavailable' };
    console.error('[feedback] could not save a report:', error.message);
    return { ok: false, status: 500, error: 'failed' };
  }
  const result = (data ?? {}) as { outcome?: string; id?: string; ref?: number; limit?: number };
  if (result.outcome === 'limit') return { ok: false, status: 429, error: 'limit', limit: result.limit ?? input.settings.dailyLimit };
  if (!result.id || typeof result.ref !== 'number') return { ok: false, status: 500, error: 'failed' };
  if (result.outcome === 'duplicate') {
    const { data: row } = await admin.from('feedback_reports').select('screenshot_count').eq('id', result.id).maybeSingle();
    return { ok: true, id: result.id, ref: result.ref, attached: Number((row as { screenshot_count?: number } | null)?.screenshot_count ?? 0), failed: 0, duplicate: true };
  }

  let attached = 0;
  let failed = 0;
  for (const [i, file] of input.files.entries()) {
    const path = screenshotPath(result.id, i + 1, file.type);
    const { data: shot, error: rowError } = await admin.from('feedback_screenshots').insert({ report_id: result.id, path, content_type: file.type, bytes: file.bytes.byteLength }).select('id').single();
    if (rowError || !shot) {
      console.error('[feedback] could not record a screenshot:', rowError?.message);
      failed += 1;
      continue;
    }
    const upload = await uploadScreenshot(path, file.bytes, file.type);
    if (upload.ok) {
      attached += 1;
      continue;
    }
    failed += 1;
    await admin.from('feedback_screenshots').delete().eq('id', (shot as { id: string }).id);
  }
  if (attached > 0) {
    const { error: countError } = await admin.from('feedback_reports').update({ screenshot_count: attached, updated_at: new Date().toISOString() }).eq('id', result.id);
    if (countError) console.error('[feedback] could not count a report’s screenshots:', countError.message);
  }
  return { ok: true, id: result.id, ref: result.ref, attached, failed, duplicate: false };
}

interface ReportForEmail {
  id: string;
  ref: number;
  user_id: string;
  kind: ReportKind;
  body: string;
  context: Partial<ReportContext> | null;
  screenshot_count: number;
  admin_emailed_at: string | null;
  created_at: string;
}

/**
 * Emails one report to the admin address, once: stamped admin_emailed_at
 * after the send, and keyed feedback-admin:<id> at Resend so a retry that
 * overlaps an earlier send is refused rather than sent twice (that refusal,
 * a 409, counts as sent). Never throws: the report is saved either way, and
 * the daily retention run retries anything not sent.
 */
export async function sendAdminReportEmail(reportId: string, opts: { failedImages?: number } = {}): Promise<{ sent: boolean; reason?: string }> {
  try {
    if (!hasServiceRole()) return { sent: false, reason: 'no_service_role' };
    const admin = createAdminClient();
    const { data, error } = await admin.from('feedback_reports').select('id, ref, user_id, kind, body, context, screenshot_count, admin_emailed_at, created_at').eq('id', reportId).maybeSingle();
    if (error || !data) return { sent: false, reason: error?.message ?? 'not_found' };
    const r = data as ReportForEmail;
    if (r.admin_emailed_at) return { sent: true, reason: 'already_sent' };
    const ctx = r.context ?? {};
    const [settings, member, profile] = await Promise.all([
      feedbackSettings(),
      admin.from('profiles').select('email, full_name').eq('id', r.user_id).maybeSingle(),
      ctx.activeProfileId ? admin.from('search_profiles').select('name').eq('id', ctx.activeProfileId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const m = (member.data ?? null) as { email: string | null; full_name: string | null } | null;
    const memberEmail = m?.email ?? ctx.email ?? null;
    const mail = adminReportEmail({
      siteUrl: siteUrl(),
      reportId: r.id,
      ref: r.ref,
      kind: r.kind,
      body: r.body,
      sentAt: r.created_at,
      memberEmail,
      memberName: m?.full_name?.trim() || null,
      planShort: planShort(ctx.plan ? (ctx as ReportContext) : null),
      plan: planLine(ctx.plan ? (ctx as ReportContext) : null),
      profileName: ((profile.data ?? null) as { name?: string } | null)?.name ?? null,
      page: ctx.page ?? null,
      device: ctx.device ?? 'Unknown device',
      screen: screenLine(ctx as ReportContext),
      appVersion: versionLine(ctx as ReportContext),
      screenshots: { attached: r.screenshot_count, failed: opts.failedImages ?? 0 },
    });
    const res = await sendEmail({ to: settings.adminEmail, subject: mail.subject, html: mail.html, text: mail.text, replyTo: safeReplyTo(memberEmail) ?? undefined, idempotencyKey: `feedback-admin:${r.id}` });
    if (!res.sent && res.reason !== 'http_409') return { sent: false, reason: res.reason };
    const { error: stampError } = await admin.from('feedback_reports').update({ admin_emailed_at: new Date().toISOString() }).eq('id', r.id).is('admin_emailed_at', null);
    if (stampError) console.error('[feedback] admin email sent but not stamped:', stampError.message);
    return { sent: true };
  } catch (err) {
    console.error('[feedback] admin email failed:', err);
    return { sent: false, reason: 'error' };
  }
}

/**
 * Reports whose admin email has not gone, old enough that their own send is
 * over and young enough to still be worth sending: the daily retention run
 * retries these.
 */
export async function unsentAdminEmails(now = new Date(), limit = 50): Promise<{ id: string; ref: number }[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient()
    .from('feedback_reports')
    .select('id, ref')
    .is('admin_emailed_at', null)
    .lt('created_at', new Date(now.getTime() - ADMIN_EMAIL_RETRY_AFTER_MINUTES * 60_000).toISOString())
    .gt('created_at', new Date(now.getTime() - ADMIN_EMAIL_RETRY_WITHIN_DAYS * 24 * 60 * 60_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (!isSchemaMissing(error)) console.error('[feedback] could not read unsent admin emails:', error.message);
    return [];
  }
  return (data ?? []) as { id: string; ref: number }[];
}

// ── "Your feedback" (/account/feedback) ──

export interface MemberReport {
  id: string;
  ref: number;
  kind: ReportKind;
  body: string;
  /** A duplicate carries its original's status and message (copied when admin changes them). */
  status: ReportStatus;
  statusMessage: string | null;
  statusChangedAt: string | null;
  screenshotCount: number;
  createdAt: string;
}

/**
 * The member's own reports, newest first: their rows only, and only the
 * columns in MEMBER_REPORT_COLUMNS, so admin's private note and the captured
 * page and device can never reach them.
 */
export async function reportsFor(userId: string): Promise<{ status: 'ok' | 'schema_missing' | 'failed'; reports: MemberReport[] }> {
  if (!hasServiceRole()) return { status: 'failed', reports: [] };
  const { data, error } = await createAdminClient()
    .from('feedback_reports')
    .select(MEMBER_REPORT_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MEMBER_LIST_MAX);
  if (error) {
    if (isSchemaMissing(error)) return { status: 'schema_missing', reports: [] };
    console.error('[feedback] could not read a member’s reports:', error.message);
    return { status: 'failed', reports: [] };
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return {
    status: 'ok',
    reports: rows.map((r) => ({
      id: String(r.id),
      ref: Number(r.ref),
      kind: r.kind as ReportKind,
      body: String(r.body ?? ''),
      status: r.status as ReportStatus,
      statusMessage: (r.status_message as string | null) ?? null,
      statusChangedAt: (r.status_changed_at as string | null) ?? null,
      screenshotCount: Number(r.screenshot_count ?? 0),
      createdAt: String(r.created_at),
    })),
  };
}
