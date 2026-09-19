import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { leadStats, parseLeadQuery } from '@/lib/api/leads-query';

export const dynamic = 'force-dynamic';

/**
 * Qualified versus unqualified, overall and per funnel.
 *
 * This is the question the whole feature exists to answer — "is my funnel
 * bringing me work worth having" — so it is one call rather than something
 * an agent has to derive by paging through every lead.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, 'leads:read');
  if (isResponse(auth)) return auth;

  const query = parseLeadQuery(new URL(request.url).searchParams);
  if (query.error) return apiError('invalid_request', query.error);

  return apiJson(await leadStats(auth.userId, query.value));
}
