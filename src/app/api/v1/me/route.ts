import { apiAccess, apiError, apiJson } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/**
 * Who this key belongs to and what it can do.
 *
 * Deliberately needs no scope: an agent has to be able to discover its own
 * reach before it tries anything, and refusing that would mean the only way
 * to learn a key's scopes is to trip over a 403.
 */
export async function GET(request: Request) {
  const access = await apiAccess(request);
  if (!access.ok || !access.user) {
    return apiError('unauthorized', 'Provide a valid API key as a Bearer token.');
  }
  return apiJson({
    user: { id: access.user.id, email: access.user.email },
    scopes: access.scopes,
    credit: {
      balancePence: access.balancePence,
      // What is left after open reservations — the number that decides
      // whether the next analysis will actually run.
      spendableBasePence: access.spendableBasePence,
    },
  });
}
