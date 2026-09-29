import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sendEmail } from '../email/send';
import { statusEmail, type FeedbackEmail } from '../email/feedback';
import { siteUrl } from '../url';
import {
  ADMIN_PAGE_SIZE,
  ADMIN_WEEKS,
  LIMITS,
  SEND_TIME_BUDGET_MS,
  STATUS_CLAIM_STALE_SECONDS,
  isEmailedStatus,
  isReportStatus,
  type EmailedStatus,
  type ReportKind,
  type ReportStatus,
} from './config';
import {
  cleanLine,
  cleanText,
  duplicateRoot,
  excerpt,
  isSchemaMissing,
  planLine,
  reportTotals,
  statusRecipients,
  weeklySubmissions,
  type RecipientReport,
  type ReportContext,
  type ReportFacts,
  type Totals,
  type WeekRow,
} from './rules';
import { signedScreenshotUrls } from './storage';

/**
 * Batch 18's admin side (/admin/feedback): the totals and the list, one
 * report in full, and every change admin makes to one: its status (with the
 * status emails), a private note, marking it a duplicate. Service role only;
 * the pages and actions check the admin before calling any of this.
 */

type Admin = ReturnType<typeof createAdminClient>;
type LoadStatus = 'ok' | 'no_service_role' | 'schema_missing' | 'failed';

export type StatusFilter = ReportStatus | 'duplicate' | null;

export interface AdminListRow {
  id: string;
  ref: number;
  kind: ReportKind;
  status: ReportStatus;
  duplicateOfRef: number | null;
  excerpt: string;
  screenshots: number;
  createdAt: string;
  memberEmail: string | null;
  plan: string;
  /** The email to the admin address has not gone out (and is due). */
  emailPending: boolean;
}

export interface AdminOverview {
  status: LoadStatus;
  message: string | null;
  totals: Totals | null;
  weeks: WeekRow[];
  rows: AdminListRow[];
  total: number;
  page: number;
  pages: number;
}

async function emailsFor(admin: Admin, userIds: string[]): Promise<Map<string, { email: string | null; name: string | null }>> {
  const out = new Map<string, { email: string | null; name: string | null }>();
  const ids = [...new Set(userIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await admin.from('profiles').select('id, email, full_name').in('id', ids.slice(i, i + 100));
    for (const p of (data ?? []) as { id: string; email: string | null; full_name: string | null }[]) out.set(p.id, { email: p.email, name: p.full_name });
  }
  return out;
}

/** The top of /admin/feedback: totals, weeks, and one page of the list. Never throws. */
export async function loadAdminOverview(opts: { kind: ReportKind | null; status: StatusFilter; page: number; now?: Date }): Promise<AdminOverview> {
  const empty: AdminOverview = { status: 'failed', message: null, totals: null, weeks: [], rows: [], total: 0, page: 1, pages: 1 };
  if (!hasServiceRole()) return { ...empty, status: 'no_service_role' };
  const now = opts.now ?? new Date();
  const admin = createAdminClient();
  try {
    const facts: ReportFacts[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
      const { data, error } = await admin.from('feedback_reports').select('kind, status, duplicate_of, created_at').order('created_at', { ascending: true }).range(from, from + 999);
      if (error) return { ...empty, status: isSchemaMissing(error) ? 'schema_missing' : 'failed', message: error.message };
      const rows = (data ?? []) as { kind: ReportKind; status: ReportStatus; duplicate_of: string | null; created_at: string }[];
      for (const r of rows) facts.push({ kind: r.kind, status: r.status, duplicateOf: r.duplicate_of, createdAt: r.created_at });
      if (rows.length < 1000) break;
    }

    const page = Math.max(1, Math.floor(opts.page) || 1);
    let q = admin.from('feedback_reports').select('id, ref, kind, status, duplicate_of, body, screenshot_count, created_at, user_id, context, admin_emailed_at', { count: 'exact' });
    if (opts.kind) q = q.eq('kind', opts.kind);
    if (opts.status === 'duplicate') q = q.not('duplicate_of', 'is', null);
    else if (opts.status) q = q.eq('status', opts.status).is('duplicate_of', null);
    const from = (page - 1) * ADMIN_PAGE_SIZE;
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + ADMIN_PAGE_SIZE - 1);
    if (error) return { ...empty, status: 'failed', message: error.message };
    const rows = (data ?? []) as { id: string; ref: number; kind: ReportKind; status: ReportStatus; duplicate_of: string | null; body: string; screenshot_count: number; created_at: string; user_id: string; context: Partial<ReportContext> | null; admin_emailed_at: string | null }[];
    const [people, originals] = await Promise.all([
      emailsFor(admin, rows.map((r) => r.user_id)),
      (async () => {
        const ids = [...new Set(rows.map((r) => r.duplicate_of).filter((v): v is string => Boolean(v)))];
        if (ids.length === 0) return new Map<string, number>();
        const { data: o } = await admin.from('feedback_reports').select('id, ref').in('id', ids);
        return new Map(((o ?? []) as { id: string; ref: number }[]).map((x) => [x.id, x.ref]));
      })(),
    ]);
    const due = now.getTime() - 10 * 60_000;
    const total = count ?? rows.length;
    return {
      status: 'ok',
      message: null,
      totals: reportTotals(facts, now),
      weeks: weeklySubmissions(facts, now, ADMIN_WEEKS),
      rows: rows.map((r) => ({
        id: r.id,
        ref: r.ref,
        kind: r.kind,
        status: r.status,
        duplicateOfRef: r.duplicate_of ? (originals.get(r.duplicate_of) ?? null) : null,
        excerpt: excerpt(r.body, 140),
        screenshots: r.screenshot_count,
        createdAt: r.created_at,
        memberEmail: people.get(r.user_id)?.email ?? r.context?.email ?? null,
        plan: planLine(r.context?.plan ? (r.context as ReportContext) : null),
        emailPending: !r.admin_emailed_at && new Date(r.created_at).getTime() < due,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
    };
  } catch (err) {
    console.error('[feedback] admin overview failed:', err);
    return { ...empty, message: err instanceof Error ? err.message : 'failed' };
  }
}

// ── One report ──

export interface AdminScreenshot {
  id: string;
  url: string | null;
  bytes: number;
  deletedAt: string | null;
}

export interface AdminReport {
  id: string;
  ref: number;
  kind: ReportKind;
  status: ReportStatus;
  body: string;
  statusMessage: string | null;
  statusChangedAt: string | null;
  adminNote: string | null;
  context: Partial<ReportContext>;
  createdAt: string;
  adminEmailedAt: string | null;
  member: { id: string; email: string | null; name: string | null };
  profileName: string | null;
  duplicateOf: { id: string; ref: number } | null;
  duplicates: { id: string; ref: number; email: string | null; createdAt: string }[];
  screenshots: AdminScreenshot[];
  statusEmails: { reportRef: number; email: string | null; status: EmailedStatus; state: string; sentAt: string | null; error: string | null }[];
  announcements: { id: string; title: string; publishedAt: string | null }[];
}

/** One report, in full, for /admin/feedback/[id]; null when there is none. Screenshots come with links that expire. */
export async function loadAdminReport(id: string): Promise<{ status: LoadStatus; report: AdminReport | null }> {
  if (!hasServiceRole()) return { status: 'no_service_role', report: null };
  const admin = createAdminClient();
  const { data, error } = await admin.from('feedback_reports').select('id, ref, user_id, kind, status, body, status_message, status_changed_at, admin_note, context, created_at, admin_emailed_at, duplicate_of').eq('id', id).maybeSingle();
  if (error) return { status: isSchemaMissing(error) ? 'schema_missing' : 'failed', report: null };
  if (!data) return { status: 'ok', report: null };
  const r = data as { id: string; ref: number; user_id: string; kind: ReportKind; status: ReportStatus; body: string; status_message: string | null; status_changed_at: string | null; admin_note: string | null; context: Partial<ReportContext> | null; created_at: string; admin_emailed_at: string | null; duplicate_of: string | null };
  const ctx = r.context ?? {};
  const [shots, dups, original, profile, announcements] = await Promise.all([
    admin.from('feedback_screenshots').select('id, path, bytes, deleted_at').eq('report_id', r.id).order('created_at', { ascending: true }),
    admin.from('feedback_reports').select('id, ref, user_id, created_at').eq('duplicate_of', r.id).order('created_at', { ascending: true }),
    r.duplicate_of ? admin.from('feedback_reports').select('id, ref').eq('id', r.duplicate_of).maybeSingle() : Promise.resolve({ data: null }),
    ctx.activeProfileId ? admin.from('search_profiles').select('name').eq('id', ctx.activeProfileId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('announcements').select('id, title, published_at').contains('report_ids', [r.id]),
  ]);
  const shotRows = (shots.data ?? []) as { id: string; path: string; bytes: number; deleted_at: string | null }[];
  const dupRows = (dups.data ?? []) as { id: string; ref: number; user_id: string; created_at: string }[];
  const family = [r.id, ...dupRows.map((d) => d.id)];
  const [urls, people, emails] = await Promise.all([
    signedScreenshotUrls(shotRows.filter((s) => !s.deleted_at).map((s) => s.path)),
    emailsFor(admin, [r.user_id, ...dupRows.map((d) => d.user_id)]),
    admin.from('feedback_status_emails').select('report_id, user_id, status, state, sent_at, error').in('report_id', family).order('claimed_at', { ascending: true }),
  ]);
  const refOf = new Map<string, number>([[r.id, r.ref], ...dupRows.map((d) => [d.id, d.ref] as [string, number])]);
  const emailRows = (emails.data ?? []) as { report_id: string; user_id: string; status: EmailedStatus; state: string; sent_at: string | null; error: string | null }[];
  const extraPeople = await emailsFor(admin, emailRows.map((e) => e.user_id).filter((u) => !people.has(u)));
  const who = (u: string) => people.get(u) ?? extraPeople.get(u);
  return {
    status: 'ok',
    report: {
      id: r.id,
      ref: r.ref,
      kind: r.kind,
      status: r.status,
      body: r.body,
      statusMessage: r.status_message,
      statusChangedAt: r.status_changed_at,
      adminNote: r.admin_note,
      context: ctx,
      createdAt: r.created_at,
      adminEmailedAt: r.admin_emailed_at,
      member: { id: r.user_id, email: who(r.user_id)?.email ?? ctx.email ?? null, name: who(r.user_id)?.name ?? null },
      profileName: ((profile.data ?? null) as { name?: string } | null)?.name ?? null,
      duplicateOf: (original.data as { id: string; ref: number } | null) ?? null,
      duplicates: dupRows.map((d) => ({ id: d.id, ref: d.ref, email: who(d.user_id)?.email ?? null, createdAt: d.created_at })),
      screenshots: shotRows.map((s) => ({ id: s.id, url: s.deleted_at ? null : (urls.get(s.path) ?? null), bytes: s.bytes, deletedAt: s.deleted_at })),
      statusEmails: emailRows.map((e) => ({ reportRef: refOf.get(e.report_id) ?? 0, email: who(e.user_id)?.email ?? null, status: e.status, state: e.state, sentAt: e.sent_at, error: e.error })),
      announcements: ((announcements.data ?? []) as { id: string; title: string; published_at: string | null }[]).map((a) => ({ id: a.id, title: a.title, publishedAt: a.published_at })),
    },
  };
}

// ── Status and the status emails ──

interface FamilyRow {
  id: string;
  ref: number;
  user_id: string;
  kind: ReportKind;
  body: string;
  status: ReportStatus;
  status_message: string | null;
  duplicate_of: string | null;
  created_at: string;
}

const FAMILY_COLUMNS = 'id, ref, user_id, kind, body, status, status_message, duplicate_of, created_at';

async function recipientReports(admin: Admin, rows: FamilyRow[]): Promise<RecipientReport[]> {
  const people = await emailsFor(admin, rows.map((r) => r.user_id));
  return rows.map((r) => {
    const p = people.get(r.user_id);
    const first = p?.name?.trim().split(/\s+/)[0] ?? null;
    return { id: r.id, ref: r.ref, userId: r.user_id, email: p?.email ?? null, firstName: first && first.length <= 40 ? first : null, kind: r.kind, body: r.body, createdAt: r.created_at };
  });
}

export interface RecipientPreview {
  ref: number;
  email: string | null;
  /** What Save would do for this member. */
  outcome: 'send' | 'retry' | 'already_told' | 'no_email';
}

export interface SendSummary {
  sent: number;
  failed: number;
  skipped: number;
  already: number;
  /** Members not reached because the time ran out: press again. */
  remaining: number;
}

function statusMail(r: RecipientReport, status: EmailedStatus, message: string | null): FeedbackEmail {
  return statusEmail({ siteUrl: siteUrl(), reportId: r.id, ref: r.ref, kind: r.kind, status, firstName: r.firstName, reportedAt: r.createdAt, body: r.body, message });
}

/**
 * Tells each recipient once: claims the row first (feedback_status_claim),
 * then sends with its own idempotency key, then records sent, failed or
 * skipped (no address). A claim that is refused means someone was already
 * told, or is being told right now. Stops after SEND_TIME_BUDGET_MS and
 * says how many are left, so a press again finishes the job.
 */
async function sendStatusEmails(admin: Admin, recipients: { report: RecipientReport; skip: boolean }[], status: EmailedStatus, message: string | null): Promise<SendSummary> {
  const started = Date.now();
  const summary: SendSummary = { sent: 0, failed: 0, skipped: 0, already: 0, remaining: 0 };
  for (const [i, { report: r, skip }] of recipients.entries()) {
    if (Date.now() - started > SEND_TIME_BUDGET_MS) {
      summary.remaining = recipients.length - i;
      break;
    }
    const { data: claimed, error } = await admin.rpc('feedback_status_claim', { p: { report: r.id, user: r.userId, status, message: message ?? '', stale_seconds: STATUS_CLAIM_STALE_SECONDS } });
    if (error) {
      console.error('[feedback] status email claim failed:', error.message);
      summary.failed += 1;
      continue;
    }
    if (!claimed) {
      summary.already += 1;
      continue;
    }
    const mark = (state: 'sent' | 'failed' | 'skipped', err: string | null) =>
      admin.from('feedback_status_emails').update({ state, sent_at: state === 'sent' ? new Date().toISOString() : null, error: err }).eq('report_id', r.id).eq('status', status);
    if (skip || !r.email) {
      await mark('skipped', 'no email address');
      summary.skipped += 1;
      continue;
    }
    const mail = statusMail(r, status, message);
    const res = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, idempotencyKey: `feedback-status:${r.id}:${status}` });
    if (res.sent || res.reason === 'http_409') {
      await mark('sent', null);
      summary.sent += 1;
    } else {
      await mark('failed', res.reason ?? 'failed');
      summary.failed += 1;
    }
  }
  return summary;
}

async function familyOf(admin: Admin, rootId: string): Promise<{ root: FamilyRow | null; dups: FamilyRow[] }> {
  const { data } = await admin.from('feedback_reports').select(FAMILY_COLUMNS).or(`id.eq.${rootId},duplicate_of.eq.${rootId}`);
  const rows = (data ?? []) as FamilyRow[];
  return { root: rows.find((r) => r.id === rootId) ?? null, dups: rows.filter((r) => r.id !== rootId) };
}

async function previewFor(admin: Admin, recipients: { report: RecipientReport; skip: boolean }[], status: EmailedStatus, message: string | null): Promise<{ recipients: RecipientPreview[]; email: FeedbackEmail | null }> {
  const { data } = await admin.from('feedback_status_emails').select('report_id, state').eq('status', status).in('report_id', recipients.map((r) => r.report.id));
  const state = new Map(((data ?? []) as { report_id: string; state: string }[]).map((e) => [e.report_id, e.state]));
  const out: RecipientPreview[] = recipients.map(({ report: r, skip }) => {
    const s = state.get(r.id);
    const outcome: RecipientPreview['outcome'] = s === 'sent' || s === 'skipped' ? 'already_told' : skip || !r.email ? 'no_email' : s ? 'retry' : 'send';
    return { ref: r.ref, email: r.email, outcome };
  });
  const firstToSend = recipients.find((r, i) => out[i].outcome === 'send' || out[i].outcome === 'retry') ?? recipients[0];
  return { recipients: out, email: firstToSend ? statusMail(firstToSend.report, status, message) : null };
}

export type StatusChange =
  | { ok: false; message: string }
  | { ok: true; dry: true; recipients: RecipientPreview[]; email: FeedbackEmail | null; emails: boolean }
  | { ok: true; dry: false; summary: SendSummary | null };

/**
 * Moves a report to a new status, with its duplicates, and (for planned,
 * done and not_doing) tells each member who sent one, once. `dry`: says who
 * would be told what, and shows the email, changing nothing. A duplicate's
 * status is its original's, so it cannot be changed on its own.
 */
export async function changeStatus(input: { reportId: string; status: unknown; message: unknown; dry: boolean }): Promise<StatusChange> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  if (!isReportStatus(input.status)) return { ok: false, message: 'Choose a status.' };
  const status = input.status;
  const rawMessage = typeof input.message === 'string' ? input.message : '';
  let message: string | null = null;
  if (rawMessage.trim() !== '') {
    const line = cleanLine(rawMessage, LIMITS.statusMessageMax);
    if (!line.ok) return { ok: false, message: `The note is one line of at most ${LIMITS.statusMessageMax} characters.` };
    message = line.text;
  }
  const admin = createAdminClient();
  const { root, dups } = await familyOf(admin, input.reportId);
  if (!root) return { ok: false, message: 'That report could not be found.' };
  if (root.duplicate_of) return { ok: false, message: 'This is a duplicate: it follows its original. Change the original instead, or undo the duplicate first.' };
  const emails = isEmailedStatus(status);
  const recipients = emails ? statusRecipients((await recipientReports(admin, [root]))[0], await recipientReports(admin, dups)) : [];

  if (input.dry) {
    if (!emails) return { ok: true, dry: true, recipients: [], email: null, emails: false };
    const preview = await previewFor(admin, recipients, status, message);
    return { ok: true, dry: true, ...preview, emails: true };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from('feedback_reports')
    .update({ status, status_message: emails ? message : null, status_changed_at: now, updated_at: now })
    .or(`id.eq.${root.id},duplicate_of.eq.${root.id}`);
  if (error) return { ok: false, message: `Could not save: ${error.message}` };
  if (!emails) return { ok: true, dry: false, summary: null };
  return { ok: true, dry: false, summary: await sendStatusEmails(admin, recipients, status, message) };
}

/** Sends the status emails that failed (or never finished) for this report's current status. */
export async function retryStatusEmails(reportId: string): Promise<StatusChange> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const admin = createAdminClient();
  const { root, dups } = await familyOf(admin, reportId);
  if (!root) return { ok: false, message: 'That report could not be found.' };
  if (!isEmailedStatus(root.status)) return { ok: false, message: 'Nothing to send: this status does not email anyone.' };
  const recipients = statusRecipients((await recipientReports(admin, [root]))[0], await recipientReports(admin, dups));
  return { ok: true, dry: false, summary: await sendStatusEmails(admin, recipients, root.status, root.status_message) };
}

// ── Duplicates ──

export type DuplicateChange = { ok: false; message: string } | { ok: true; message: string; summary: SendSummary | null };

/**
 * Marks a report a duplicate of report #ofRef. It points at that report's
 * original (duplicates never chain), and so does anything that pointed at
 * this one; they all take the original's status and note. `tell`: if the
 * original has already moved on (planned, fixed or built, not doing), the
 * members whose reports just joined it are told, once.
 */
export async function markDuplicate(input: { reportId: string; ofRef: unknown; tell: boolean }): Promise<DuplicateChange> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const ref = Number(String(input.ofRef ?? '').replace(/^#/, '').trim());
  if (!Number.isInteger(ref) || ref < 1) return { ok: false, message: 'Give the number of the original report, like #12.' };
  const admin = createAdminClient();
  const { data: target } = await admin.from('feedback_reports').select('id').eq('ref', ref).maybeSingle();
  if (!target) return { ok: false, message: `There is no report #${ref}.` };
  // Each report up the target's chain, and what it is a duplicate of (the
  // rule itself, and its loop check, is duplicateRoot in rules.ts).
  const targetId = (target as { id: string }).id;
  const parents = new Map<string, string | null>();
  for (let id: string | null = targetId, hops = 0; id && hops < 20 && !parents.has(id); hops += 1) {
    const found: { data: unknown } = await admin.from('feedback_reports').select('duplicate_of').eq('id', id).maybeSingle();
    const row = found.data as { duplicate_of: string | null } | null;
    if (!row) break;
    const next: string | null = row.duplicate_of;
    parents.set(id, next);
    id = next;
  }
  const verdict = duplicateRoot(input.reportId, targetId, (id) => (parents.has(id) ? parents.get(id) : undefined));
  if (!verdict.ok) {
    return { ok: false, message: verdict.reason === 'self' ? 'A report cannot be a duplicate of itself.' : verdict.reason === 'loop' ? `#${ref} is already a duplicate of this report. Undo that first.` : `There is no report #${ref}.` };
  }
  const { data: rootRow } = await admin.from('feedback_reports').select(FAMILY_COLUMNS).eq('id', verdict.rootId).maybeSingle();
  const root = rootRow as FamilyRow | null;
  if (!root) return { ok: false, message: `There is no report #${ref}.` };
  // The report and its own duplicates move onto the original. Found first
  // and updated by id: PostgREST applies an or() again to the rows an update
  // returns, which would drop the duplicates that just moved (so their
  // reporters would not be told).
  const { data: family, error: familyError } = await admin.from('feedback_reports').select('id').or(`id.eq.${input.reportId},duplicate_of.eq.${input.reportId}`);
  if (familyError) return { ok: false, message: `Could not save: ${familyError.message}` };
  const familyIds = ((family ?? []) as { id: string }[]).map((r) => r.id);
  if (!familyIds.includes(input.reportId)) return { ok: false, message: 'That report could not be found.' };
  const now = new Date().toISOString();
  const { data: moved, error } = await admin
    .from('feedback_reports')
    .update({ duplicate_of: root.id, status: root.status, status_message: root.status_message, status_changed_at: now, updated_at: now })
    .in('id', familyIds)
    .select(FAMILY_COLUMNS);
  if (error) return { ok: false, message: `Could not save: ${error.message}` };
  const movedRows = (moved ?? []) as FamilyRow[];
  let summary: SendSummary | null = null;
  if (input.tell && isEmailedStatus(root.status) && movedRows.length > 0) {
    const all = statusRecipients((await recipientReports(admin, [root]))[0], await recipientReports(admin, movedRows));
    summary = await sendStatusEmails(admin, all.filter((r) => r.report.id !== root.id), root.status, root.status_message);
  }
  return { ok: true, message: `Marked a duplicate of #${root.ref}.`, summary };
}

export async function undoDuplicate(reportId: string): Promise<DuplicateChange> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const { error } = await createAdminClient().from('feedback_reports').update({ duplicate_of: null, updated_at: new Date().toISOString() }).eq('id', reportId);
  return error ? { ok: false, message: `Could not save: ${error.message}` } : { ok: true, message: 'No longer a duplicate.', summary: null };
}

// ── The private note ──

export async function saveNote(reportId: string, note: unknown): Promise<{ ok: boolean; message: string }> {
  if (!hasServiceRole()) return { ok: false, message: 'The service role key is not set.' };
  const raw = typeof note === 'string' ? note : '';
  let value: string | null = null;
  if (raw.trim() !== '') {
    const t = cleanText(raw, LIMITS.adminNoteMax);
    if (!t.ok) return { ok: false, message: `A note is at most ${LIMITS.adminNoteMax.toLocaleString('en-GB')} characters.` };
    value = t.text;
  }
  const { error } = await createAdminClient().from('feedback_reports').update({ admin_note: value, updated_at: new Date().toISOString() }).eq('id', reportId);
  return error ? { ok: false, message: `Could not save: ${error.message}` } : { ok: true, message: value ? 'Note saved.' : 'Note cleared.' };
}

