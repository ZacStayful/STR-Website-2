import { requireScope, isResponse, apiError } from '@/lib/api/auth';
import { listLeads, parseLeadQuery } from '@/lib/api/leads-query';
import { leadsCsv } from '@/lib/api/csv';

export const dynamic = 'force-dynamic';

/** Hard ceiling per request; a bigger export pages with `offset`. */
const EXPORT_LIMIT = 1000;

/**
 * Leads as CSV, for a spreadsheet or a bulk import.
 *
 * Leads only — never mixed with a member's own reports, for the same reason
 * nothing else here mixes them.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, 'leads:read');
  if (isResponse(auth)) return auth;

  const params = new URL(request.url).searchParams;
  const query = parseLeadQuery(params);
  if (query.error) return apiError('invalid_request', query.error);

  const page = await listLeads(auth.userId, { ...query.value, limit: Math.min(EXPORT_LIMIT, Math.max(query.value.limit, EXPORT_LIMIT)) });
  const csv = leadsCsv(page.leads);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
