import 'server-only';

import { sendEmail, isEmailConfigured } from './send';
import { brandedFrom, safeReplyTo } from './from.ts';
import { escapeHtml } from './escape';
import type { FunnelBrand } from '../funnels/brand';

/**
 * Sending a prospect the link back to their own report.
 *
 * Without this the report exists at /r/<token>, is linked from the
 * customer's CRM row, and is unreachable by the one person who actually
 * asked for it: they read it once, close the tab, and it is gone. The token
 * was being minted and never handed over.
 *
 * Everything here is the CUSTOMER's, not ours. The display name is theirs,
 * the colours are theirs, the reply-to is theirs, and Stayful is not
 * mentioned — a prospect who filled in a form branded as someone else's and
 * then gets an email from a company they have never heard of reads it as
 * spam, which is the opposite of the point.
 *
 * The sending ADDRESS is still ours, because sending from a customer's own
 * domain needs per-customer DNS verification that does not exist yet. See
 * ./from.ts for why the display name has to be sanitised on the way in.
 */

export interface LeadReportEmailInput {
  to: string;
  brand: FunnelBrand;
  reportUrl: string;
  /** The property they asked about, for the subject line. */
  address: string | null;
}

export async function sendLeadReportEmail(input: LeadReportEmailInput): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const company = input.brand.companyName;
  const from = brandedFrom(process.env.EMAIL_FROM, company);
  if (!from) return false;

  const replyTo = safeReplyTo(input.brand.replyToEmail);
  const primary = input.brand.primary ?? '#2E3D2B';
  const who = company ?? 'us';
  const property = input.address?.trim();

  const subject = property
    ? `Your property report — ${property}`
    : 'Your property report';

  const intro = property
    ? `Here is your short-term let income report for ${property}.`
    : 'Here is your short-term let income report.';

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f5f0;padding:24px;color:#1f2a1d">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e3da">
${input.brand.logoUrl ? `<img src="${escapeHtml(input.brand.logoUrl)}" alt="${escapeHtml(who)}" style="max-height:40px;margin-bottom:16px" />` : `<h2 style="font-size:16px;margin:0 0 16px">${escapeHtml(who)}</h2>`}
<h1 style="font-size:20px;margin:0 0 12px">Your property report</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(intro)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 12px">It covers what the property could earn as a short-term let, how it compares with letting it long-term, and what the local market looks like. You can come back to this link whenever you like, and download it as a PDF.</p>
<p style="margin:20px 0 0"><a href="${escapeHtml(input.reportUrl)}" style="display:inline-block;background:${escapeHtml(primary)};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open your report</a></p>
${replyTo ? `<p style="font-size:14px;line-height:1.5;margin:20px 0 0;color:#4b5563">Any questions, just reply to this email.</p>` : ''}
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">Sent by ${escapeHtml(who)}${property ? ` about ${escapeHtml(property)}` : ''}.</p>
</div></body></html>`;

  const text = [
    `Your property report`,
    '',
    intro,
    '',
    'It covers what the property could earn as a short-term let, how it compares with letting it long-term, and what the local market looks like. You can come back to this link whenever you like, and download it as a PDF.',
    '',
    input.reportUrl,
    '',
    replyTo ? 'Any questions, just reply to this email.' : '',
    `Sent by ${who}.`,
  ].filter(Boolean).join('\n');

  const res = await sendEmail({
    to: input.to,
    subject,
    html,
    text,
    from,
    ...(replyTo ? { replyTo } : {}),
  });
  return res.sent;
}
