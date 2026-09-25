import { leadByReportToken } from '@/lib/leads/report';
import { touchLeadByReportToken } from '@/lib/leads/activity';
import { renderReportPdf, pdfBrandForFunnel, reportFilename } from '@/lib/pdf/render';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The prospect's report as a PDF, at the same token as the page.
 *
 * This is the link that goes into the customer's CRM, so it has to keep
 * working long after the prospect's browser tab is closed — which is why it
 * re-renders from the stored analysis rather than depending on anything the
 * client held.
 *
 * The token is the whole credential, exactly as on the page. Rendering is
 * unmetered compute, so the gate is that the token must resolve to a lead
 * with a finished report: a made-up token renders nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lead = await leadByReportToken(token);
  if (!lead) return new Response('Not found', { status: 404 });

  const brand = await pdfBrandForFunnel(lead.brand);
  const buffer = await renderReportPdf(lead.result, {
    brand,
    preparedFor: lead.email ?? undefined,
  });

  // The prospect (or the customer, from their CRM) coming back to the report
  // is the lead still being used (retention.ts).
  await touchLeadByReportToken(token);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // inline, not attachment: this link is clicked from a CRM row, where
      // opening it is what someone wants and a silent download is not.
      'Content-Disposition': `inline; filename="${reportFilename(lead.result, brand)}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
