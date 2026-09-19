import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { listLeads, parseLeadQuery } from '@/lib/api/leads-query';

export const dynamic = 'force-dynamic';

/**
 * A customer's leads.
 *
 * Only leads. A member's own analyser reports are /api/v1/reports and no
 * endpoint returns both: they are different things bought in different ways,
 * and a response mixing them would make every count downstream meaningless.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, 'leads:read');
  if (isResponse(auth)) return auth;

  const query = parseLeadQuery(new URL(request.url).searchParams);
  if (query.error) return apiError('invalid_request', query.error);

  const page = await listLeads(auth.userId, query.value);
  return apiJson(page);
}
