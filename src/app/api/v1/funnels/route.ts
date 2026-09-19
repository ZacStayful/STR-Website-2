import { requireScope, isResponse, apiJson } from '@/lib/api/auth';
import { listFunnels } from '@/lib/funnels';
import { siteUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

/**
 * A customer's funnels.
 *
 * The public token is included: it is not a secret from its owner, it is
 * the link they are meant to publish, and an agent setting a funnel up for
 * them needs to be able to hand it over.
 */
export async function GET(request: Request) {
  const auth = await requireScope(request, 'funnels:read');
  if (isResponse(auth)) return auth;

  const funnels = await listFunnels(auth.userId);
  return apiJson({
    funnels: funnels.map((f) => ({
      id: f.id,
      name: f.name,
      active: f.active,
      url: siteUrl(`/f/${f.publicToken}`),
      reportDepth: f.reportDepth,
      unqualifiedPolicy: f.unqualifiedPolicy,
      dailyCap: f.dailyCap,
      rules: f.leadRules,
      createdAt: f.createdAt,
    })),
  });
}
