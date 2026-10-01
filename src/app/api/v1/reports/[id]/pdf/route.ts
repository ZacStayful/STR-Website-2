import { requireScope, isResponse, apiError } from '@/lib/api/auth';
import { getReport } from '@/lib/api/reports-query';
import { renderReportPdf, reportFilename } from '@/lib/pdf/render';
import { logActivity } from '@/lib/activity/log';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * A member's own report as a PDF. No brand is passed, so this renders the
 * Stayful report — it is their report, from their own analyser history, and
 * a funnel's white-label branding has nothing to do with it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'reports:read');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const report = await getReport(auth.userId, id);
  if (!report?.result) return apiError('not_found', 'No report with that id.');

  const buffer = await renderReportPdf(report.result);
  // Batch 21 (E18): recorded (never weekly active: an agent, not the member in the app).
  logActivity(auth.userId, 'api_pdf', { source: 'system', extras: { report: id } });
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportFilename(report.result)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
