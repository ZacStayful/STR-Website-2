import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { getReport } from '@/lib/api/reports-query';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'reports:read');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const report = await getReport(auth.userId, id);
  if (!report) return apiError('not_found', 'No report with that id.');
  return apiJson(report);
}
