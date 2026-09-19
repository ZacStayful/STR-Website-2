import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { getFunnel, updateFunnel } from '@/lib/funnels';
import { parseLeadRules, rulesAreEmpty } from '@/lib/leads/rules';

export const dynamic = 'force-dynamic';

/**
 * Reading and changing a funnel's qualification rules.
 *
 * The rules are the one funnel setting worth driving from an agent: a
 * customer saying "only send me four-bed places over £60k this month" is a
 * sentence, and this is what turns it into a stored rule.
 *
 * Branding, the privacy policy and the activation switch are deliberately
 * not here. Those decide how a page looks to the public and whether it is
 * collecting strangers' personal data, and they should be changed by a
 * person looking at the result.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'funnels:read');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const funnel = await getFunnel(auth.userId, id);
  if (!funnel) return apiError('not_found', 'No funnel with that id.');
  return apiJson({ funnelId: funnel.id, rules: funnel.leadRules, unqualifiedPolicy: funnel.unqualifiedPolicy });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'funnels:write');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const funnel = await getFunnel(auth.userId, id);
  if (!funnel) return apiError('not_found', 'No funnel with that id.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalid_request', 'Send a JSON body.');
  }

  const raw = (body && typeof body === 'object' ? (body as Record<string, unknown>).rules ?? body : null);
  const rules = parseLeadRules(raw);

  // parseLeadRules is deliberately tolerant — an unusable stored value
  // becomes "no filter" so a lead is never lost to a bad rule. That is right
  // when READING, and wrong when writing: an agent that sends nonsense would
  // silently switch every filter off. So a write that parses to nothing when
  // something was clearly meant is refused instead.
  if (rulesAreEmpty(rules) && raw !== null && typeof raw === 'object' && Object.keys(raw).length > 0) {
    return apiError('invalid_request', 'None of those rules could be understood, so nothing was changed. Check the field names and value ranges.');
  }

  const ok = await updateFunnel(auth.userId, id, { leadRules: rules });
  if (!ok) return apiError('server_error', 'Could not save those rules.');
  return apiJson({ funnelId: id, rules });
}
