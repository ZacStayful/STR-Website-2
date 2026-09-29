/**
 * Batch 18's two emails (src/lib/feedback).
 *
 *   adminReportEmail  every bug report and idea, to billing_settings.
 *                     feedback_admin_email as soon as it is sent: what the
 *                     member wrote, where from, their plan, and a link to it
 *                     in admin. Never a screenshot or a link to one: those
 *                     stay behind admin's sign-in.
 *   statusEmail       to a member when their report is planned, fixed or
 *                     built, or not being done: their own words, the news,
 *                     and admin's one line if there is one.
 *
 * Both are replies to something the member did, like a receipt, so they sit
 * outside the one-email-a-day cap (src/lib/notify/cap.ts): each is sent
 * straight through sendEmail with its own idempotency key. Everything a
 * member wrote is escaped, and never goes into a subject line.
 *
 * Pure: the sender is src/lib/feedback/server.ts.
 */
import { escapeHtml as esc } from './escape.ts';
import { withVia } from '../activity/heartbeat.ts';
import { LIMITS, type EmailedStatus, type ReportKind } from '../feedback/config.ts';
import { excerpt, kindLabel, statusLabel } from '../feedback/rules.ts';

export interface FeedbackEmail {
  subject: string;
  text: string;
  html: string;
}

/** A subject or a header-bound value: one line, no controls. */
export function oneLine(s: string, max = 150): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "28 September 2026", on the UK calendar. */
export function ukDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : iso;
}

/** Escaped for HTML, with the member's line breaks kept (CRLF and CR too). */
function paragraphs(text: string): string {
  return esc(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const WRAP = `${FONT};font-size:15px;line-height:1.6;color:#2e3d2b;max-width:600px;margin:0 auto;padding:24px`;
const BUTTON = 'display:inline-block;background:#2e3d2b;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600';

// ── To admin: a new report ──

export interface AdminReportEmailInput {
  siteUrl: string;
  reportId: string;
  ref: number;
  kind: ReportKind;
  body: string;
  sentAt: string;
  memberEmail: string | null;
  memberName: string | null;
  /** The plan in a word or two for the subject: "Pro", "Pay as you go". */
  planShort: string;
  /** The plan in full: "Pro (paid)", "Team member of Acme — Starter (paused)". */
  plan: string;
  profileName: string | null;
  /** The page it was sent from (admin only). */
  page: string | null;
  device: string;
  screen: string | null;
  appVersion: string | null;
  screenshots: { attached: number; failed: number };
}

export function adminReportEmail(input: AdminReportEmailInput): FeedbackEmail {
  const base = input.siteUrl.replace(/\/$/, '');
  const adminUrl = `${base}/admin/feedback/${encodeURIComponent(input.reportId)}`;
  const heading = `${kindLabel(input.kind, 'long')} #${input.ref}`;
  const subject = oneLine(`New ${input.kind === 'bug' ? 'bug report' : 'feature request'} #${input.ref} · ${input.planShort}`);
  const who = input.memberName ? `${input.memberName} <${input.memberEmail ?? 'no email'}>` : (input.memberEmail ?? 'no email');
  const shots = input.screenshots.attached === 0 && input.screenshots.failed === 0 ? 'None' : `${input.screenshots.attached} — view in admin${input.screenshots.failed > 0 ? ` (${input.screenshots.failed} could not be attached)` : ''}`;
  const rows: [string, string][] = [
    ['From', who],
    ['Plan', input.plan],
    ...(input.profileName ? ([['Active profile', input.profileName]] as [string, string][]) : []),
    ['Page', input.page ?? 'Not captured'],
    ['Device', input.device],
    ['Screen', input.screen ?? 'Not captured'],
    ['App version', input.appVersion ?? 'unknown'],
    ['Screenshots', shots],
    ['Sent', `${ukDate(input.sentAt)}, ${new Date(input.sentAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`],
  ];
  const text = [
    heading,
    '',
    input.body,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Open in admin: ${adminUrl}`,
    '',
    'Reply to this email to answer the member. Screenshots are only in admin.',
  ].join('\n');
  const row = ([k, v]: [string, string]) => `<tr><td style="padding:3px 16px 3px 0;color:#7a8274;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0;vertical-align:top;word-break:break-word">${esc(v)}</td></tr>`;
  const html = `<div style="${WRAP}">
  <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5d8156">${esc(heading)}</p>
  <div style="margin:12px 0 18px;padding:14px 16px;border-left:3px solid #5d8156;background:#f4f6ee">${paragraphs(input.body)}</div>
  <table role="presentation" style="border-collapse:collapse;font-size:14px">${rows.map(row).join('')}</table>
  <p style="margin:22px 0"><a href="${esc(adminUrl)}" style="${BUTTON}">Open in admin</a></p>
  <p style="margin:0;font-size:12px;color:#7a8274">Reply to this email to answer the member. Screenshots are only in admin.</p>
</div>`;
  return { subject, text, html };
}

// ── To the member: what happened to their report ──

export interface StatusEmailInput {
  siteUrl: string;
  /** The member's own report: the one quoted, and the one the link opens. */
  reportId: string;
  ref: number;
  kind: ReportKind;
  status: EmailedStatus;
  firstName: string | null;
  reportedAt: string;
  body: string;
  /** Admin's one line, if any. */
  message: string | null;
}

const SUBJECTS: Record<EmailedStatus, Record<ReportKind, string>> = {
  planned: { bug: 'We’re planning a fix for the bug you reported', feature: 'We’re planning to build your idea' },
  done: { bug: 'Fixed: the bug you reported', feature: 'Built: your idea' },
  not_doing: { bug: 'About the bug you reported', feature: 'About your idea' },
};

function statusSentence(kind: ReportKind, status: EmailedStatus): string {
  if (status === 'planned') return 'It’s on our plan — we’ll email you again when it’s done.';
  if (status === 'done') return kind === 'bug' ? 'It’s fixed. Thank you for telling us.' : 'It’s built. Thank you for the idea.';
  return 'We’ve decided not to do this for now. Thank you for taking the time to tell us.';
}

/** Where the email's button goes: the member's feedback, opened at this report and marked as from this email. */
export function statusEmailLink(siteUrl: string, reportId: string, status: EmailedStatus, ref: number): string {
  const base = siteUrl.replace(/\/$/, '');
  const url = `${base}/account/feedback?report=${encodeURIComponent(reportId)}&status=${encodeURIComponent(status)}#report-${ref}`;
  return withVia(url, 'email', base);
}

export function statusEmail(input: StatusEmailInput): FeedbackEmail {
  const link = statusEmailLink(input.siteUrl, input.reportId, input.status, input.ref);
  const hi = input.firstName ? `Hi ${oneLine(input.firstName, 40)},` : 'Hi,';
  const quote = excerpt(input.body, LIMITS.quoteMax);
  const told = `On ${ukDate(input.reportedAt)} you told us:`;
  const sentence = statusSentence(input.kind, input.status);
  const note = input.message ? oneLine(input.message, LIMITS.statusMessageMax) : null;
  const label = statusLabel(input.kind, input.status, 'member');
  const subject = SUBJECTS[input.status][input.kind];
  const why = `You’re getting this because you sent us this ${input.kind === 'bug' ? 'report' : 'idea'} (reference #${input.ref}) from Stayful Intelligence.`;
  const text = [
    hi,
    '',
    told,
    `“${quote}”`,
    '',
    `${label}. ${sentence}`,
    ...(note ? ['', `A note from us: “${note}”`] : []),
    '',
    `See your feedback: ${link}`,
    '',
    'Thanks,',
    'The Stayful team',
    '',
    why,
  ].join('\n');
  const html = `<div style="${WRAP}">
  <p style="margin:0 0 14px">${esc(hi)}</p>
  <p style="margin:0 0 6px">${esc(told)}</p>
  <p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #b9d5c6;background:#f4f6ee;font-style:italic">“${esc(quote)}”</p>
  <p style="margin:0 0 14px"><strong>${esc(label)}.</strong> ${esc(sentence)}</p>
  ${note ? `<p style="margin:0 0 14px">A note from us: “${esc(note)}”</p>` : ''}
  <p style="margin:20px 0"><a href="${esc(link)}" style="${BUTTON}">See your feedback</a></p>
  <p style="margin:0">Thanks,<br>The Stayful team</p>
  <p style="margin:24px 0 0;font-size:12px;color:#7a8274">${esc(why)}</p>
</div>`;
  return { subject, text, html };
}
