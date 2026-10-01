import 'server-only';

/**
 * Batch 23: the emails around Stayful Intelligence calls.
 *   missedCallEmail   to the member: "I tried to call you" (wording in src/lib/voice/templates.ts)
 *   handoffEmail      to the admin handoff address (Batch 18's feedback_admin_email)
 *   textForwardEmail  to the same address: a text sent to the number
 * Sending never throws.
 */
import { sendEmail, isEmailConfigured } from './send';
import { escapeHtml } from './escape';
import { siteUrl, manageNotificationsUrl } from '../url';
import type { EmailCopy } from '../voice/templates';

function memberLayout(c: EmailCopy): { html: string; text: string } {
  const url = siteUrl(c.cta.path);
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f5f0;padding:24px;color:#1f2a1d">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e3da">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(c.title)}</h1>
${c.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
<p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;background:#2E3D2B;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(c.cta.label)}</a></p>
<p style="font-size:14px;margin:20px 0 0">— Stayful Intelligence</p>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">Calls from Stayful Intelligence are on in your notifications. <a href="${manageNotificationsUrl()}" style="color:#6b7280">Switch them off</a> any time.</p>
</div></body></html>`;
  const text = `${c.title}\n\n${c.paragraphs.join('\n\n')}\n\n${c.cta.label}: ${url}\n\n— Stayful Intelligence\n\nSwitch calls off: ${manageNotificationsUrl()}\n`;
  return { html, text };
}

export async function missedCallEmail(to: string, copy: EmailCopy, idempotencyKey: string): Promise<boolean> {
  if (!to || !isEmailConfigured()) return false;
  const res = await sendEmail({ to, subject: copy.subject, ...memberLayout(copy), idempotencyKey });
  return res.sent;
}

function adminLayout(title: string, rows: [string, string][], body: string | null, link: { label: string; url: string } | null): { html: string; text: string } {
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:16px;color:#1f2a1d">
<h2 style="font-size:17px;margin:0 0 10px">${escapeHtml(title)}</h2>
<table style="font-size:14px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(v)}</td></tr>`).join('')}</table>
${body ? `<p style="font-size:14px;line-height:1.5;white-space:pre-wrap;border-left:3px solid #e5e3da;padding-left:10px">${escapeHtml(body)}</p>` : ''}
${link ? `<p><a href="${link.url}">${escapeHtml(link.label)}</a></p>` : ''}
</body></html>`;
  const text = `${title}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${body ? `\n\n${body}` : ''}${link ? `\n\n${link.label}: ${link.url}` : ''}\n`;
  return { html, text };
}

export async function handoffEmail(to: string, o: { member: string; caller: string; question: string; summary: string; conversationId: string | null; callId: string }): Promise<boolean> {
  if (!to || !isEmailConfigured()) return false;
  const link = o.conversationId ? { label: 'Transcript', url: siteUrl(`/admin/conversations?id=${encodeURIComponent(o.conversationId)}`) } : null;
  const res = await sendEmail({
    to,
    subject: `Stayful Intelligence handoff: ${o.question.slice(0, 80)}`,
    ...adminLayout('A caller needs the team', [['Member', o.member], ['Caller', o.caller], ['Question', o.question]], o.summary, link),
    idempotencyKey: `si-handoff:${o.callId}`,
  });
  return res.sent;
}

export async function textForwardEmail(to: string, o: { member: string; from: string; body: string; messageSid: string; conversationId: string | null }): Promise<boolean> {
  if (!to || !isEmailConfigured()) return false;
  const link = o.conversationId ? { label: 'Conversation log', url: siteUrl(`/admin/conversations?id=${encodeURIComponent(o.conversationId)}`) } : null;
  const res = await sendEmail({
    to,
    subject: `Text to Stayful Intelligence from ${o.member}`,
    ...adminLayout('A text to the Stayful Intelligence number', [['Member', o.member], ['From', o.from]], o.body, link),
    idempotencyKey: `si-text:${o.messageSid}`,
  });
  return res.sent;
}
