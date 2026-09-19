import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { listReports } from '@/lib/api/reports-query';

export const dynamic = 'force-dynamic';

/**
 * The member's OWN analyser history — properties they chose to research.
 *
 * Never leads. That separation runs through the whole product: one is work
 * they went looking for, the other is strangers who filled in their funnel,
 * and a response mixing them would make every count downstream meaningless.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, 'reports:read');
  if (isResponse(auth)) return auth;

  const params = new URL(request.url).searchParams;
  const limitRaw = params.get('limit');
  const limit = limitRaw === null ? 50 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return apiError('invalid_request', 'limit must be a whole number between 1 and 200.');
  }
  const offsetRaw = params.get('offset');
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0) {
    return apiError('invalid_request', 'offset must be zero or more.');
  }

  return apiJson(await listReports(auth.userId, limit, offset));
}
