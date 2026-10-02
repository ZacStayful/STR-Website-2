import { escapeHtml } from './escape.ts';

/**
 * Batch 22f: "You have a new lead" — to the funnel's OWNER (never a team
 * member, never anyone else), when a landlord's report has finished. From
 * Stayful Intelligence, not the owner's brand: this one is ours to them.
 *
 * What it carries is what the owner needs to call the landlord back: their
 * name and contact details, the property's area (the postcode district, not
 * the full address — that is one tap away on the lead) and bedrooms, the
 * headline income, and whether it met their filter. Not charged.
 *
 * Pure: the runner (src/lib/funnels/new-lead-server.ts) sends it.
 */

export interface NewLeadEmailInput {
  funnelName: string;
  landlordName: string | null;
  landlordEmail: string | null;
  landlordPhone: string | null;
  /** The postcode district, e.g. "M14". */
  area: string | null;
  bedrooms: number | null;
  /** Gross short-let income a year, pounds. */
  annualIncome: number | null;
  qualified: boolean | null;
  leadUrl: string;
  pdfUrl: string | null;
  settingsUrl: string;
}

export interface EmailCopy {
  subject: string;
  html: string;
  text: string;
}

function pounds(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

function propertyLine(i: NewLeadEmailInput): string {
  const beds = i.bedrooms && i.bedrooms > 0 ? `${i.bedrooms}-bedroom property` : 'Property';
  return i.area ? `${beds} in ${i.area}` : beds;
}

function verdictLine(q: boolean | null): string {
  if (q === true) return 'Meets your lead filter';
  if (q === false) return 'Does not meet your lead filter';
  return 'No filter verdict';
}

export function newLeadEmail(i: NewLeadEmailInput): EmailCopy {
  const who = i.landlordName?.trim() || 'A landlord';
  const property = propertyLine(i);
  const income = i.annualIncome && i.annualIncome > 0 ? `${pounds(i.annualIncome)} a year estimated short-let income` : null;
  const subject = `New lead: ${who} — ${property}`.replace(/[\r\n]+/g, ' ').slice(0, 200);

  const rows: Array<[string, string]> = [
    ['Name', who],
    ...(i.landlordEmail ? ([['Email', i.landlordEmail]] as Array<[string, string]>) : []),
    ...(i.landlordPhone ? ([['Phone', i.landlordPhone]] as Array<[string, string]>) : []),
    ['Property', property],
    ...(income ? ([['Headline', income]] as Array<[string, string]>) : []),
    ['Filter', verdictLine(i.qualified)],
    ['Form', i.funnelName],
  ];

  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f5f0;padding:24px;color:#1f2a1d">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e3da">
<h1 style="font-size:20px;margin:0 0 12px">You have a new lead</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px">${escapeHtml(who)} has just had their short-let income report from your form.</p>
<table style="border-collapse:collapse;font-size:14px;width:100%">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0">${escapeHtml(v)}</td></tr>`)
    .join('')}</table>
<p style="margin:20px 0 0"><a href="${escapeHtml(i.leadUrl)}" style="display:inline-block;background:#2E3D2B;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open the lead</a>${
    i.pdfUrl ? ` &nbsp; <a href="${escapeHtml(i.pdfUrl)}" style="color:#2E3D2B;font-weight:600">Download the PDF</a>` : ''
  }</p>
<p style="font-size:12px;color:#6b7280;margin:24px 0 0">Stayful Intelligence. You get this email for each new lead on this form; <a href="${escapeHtml(i.settingsUrl)}" style="color:#6b7280">turn it off in the form's settings</a>.</p>
</div></body></html>`;

  const text = [
    'You have a new lead',
    '',
    `${who} has just had their short-let income report from your form.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Open the lead: ${i.leadUrl}`,
    ...(i.pdfUrl ? [`Download the PDF: ${i.pdfUrl}`] : []),
    '',
    `Stayful Intelligence. You get this email for each new lead on this form; turn it off in the form's settings: ${i.settingsUrl}`,
  ].join('\n');

  return { subject, html, text };
}
