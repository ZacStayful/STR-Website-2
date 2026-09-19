import { requireScope, isResponse, apiError } from '@/lib/api/auth';
import { getReport } from '@/lib/api/reports-query';
import { renderReportPdf, reportFilename } from '@/lib/pdf/render';

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
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportFilename(report.result)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
