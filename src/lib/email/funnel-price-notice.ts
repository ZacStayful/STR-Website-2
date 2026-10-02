import { escapeHtml } from './escape.ts';
import { money, withRate, type FunnelTier } from '../funnels/tiers.ts';

/**
 * Batch 22f: the funnel owners' notice of volume-tier pricing — 30 days
 * before their leads move from the metered price to the tiers. Its own email
 * and its own stamp (profiles.funnel_price_notice_sent_at); NOT the members'
 * pricing notice (./pricing-notice.ts, pricing_notice_sent_at), which is for
 * the investor prices.
 *
 * Pure: the runner (src/lib/funnels/price-notice-run.ts) sends it, after a
 * dry run on /admin/management.
 */

export interface FunnelPriceNoticeInput {
  siteUrl: string;
  firstName: string | null;
  /** The day the tiers apply to this owner (notice + 30 days), 'YYYY-MM-DD'. */
  fromDate: string;
  tiers: FunnelTier[];
  enhancedExtraPence: number;
  topupRate: number;
}

export interface EmailCopy {
  subject: string;
  html: string;
  text: string;
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(d);
}

function range(t: FunnelTier, next: FunnelTier | undefined): string {
  return next ? `Leads ${t.from}–${next.from - 1} in a month` : `Lead ${t.from} and on`;
}

export function funnelPriceNoticeEmail(i: FunnelPriceNoticeInput): EmailCopy {
  const when = longDate(i.fromDate);
  const hello = i.firstName ? `Hi ${i.firstName},` : 'Hi,';
  const rows = i.tiers.map((t, k) => `${range(t, i.tiers[k + 1])}: ${money(t.pence)} a lead (${money(withRate(t.pence, i.topupRate))} from top-up credit)`);
  const subject = `Your lead form's prices from ${when}`;
  const paras = [
    hello,
    `From ${when}, leads from your Stayful lead form are priced per lead by how many you have had that calendar month, instead of by the cost of each report.`,
    'Until then nothing changes.',
  ];
  const after = [
    `An enhanced report adds ${money(i.enhancedExtraPence)} a lead at every tier.`,
    'You only pay for reports that ran: a repeat enquiry from the same landlord and a report that fails are never charged.',
    'Every lead is also emailed to you as it arrives; you can turn that off on your form.',
    'You can pause your form at any time from Leads.',
  ];
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f5f0;padding:24px;color:#1f2a1d">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e3da">
${paras.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
<ul style="font-size:15px;line-height:1.6;margin:0 0 12px;padding-left:20px">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
${after.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
<p style="margin:20px 0 0"><a href="${escapeHtml(i.siteUrl)}/leads/funnels" style="display:inline-block;background:#2E3D2B;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Your lead forms</a></p>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">Stayful Intelligence. You get this because you have a lead form with us.</p>
</div></body></html>`;
  const text = [...paras, '', ...rows.map((r) => `- ${r}`), '', ...after, '', `Your lead forms: ${i.siteUrl}/leads/funnels`, '', 'Stayful Intelligence. You get this because you have a lead form with us.'].join('\n');
  return { subject, html, text };
}
