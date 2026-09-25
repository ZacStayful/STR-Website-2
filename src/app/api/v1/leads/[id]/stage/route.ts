import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { setLeadStage } from '@/lib/api/leads-write';
import { parseStage, LEAD_STAGES } from '@/lib/leads/stage';
import { touchLeads } from '@/lib/leads/activity';

export const dynamic = 'force-dynamic';

/**
 * Sets the customer's own sales stage on a lead — the pipeline for anyone
 * managing leads here rather than in a CRM. Nothing is sent to the CRM when
 * it changes: a CRM keeps its own stages, and two systems overwriting each
 * other's would be worse than either alone.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'leads:write');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalid_request', 'Send a JSON body.');
  }

  const stage = parseStage(body && typeof body === 'object' ? (body as Record<string, unknown>).stage : null);
  if (!stage) return apiError('invalid_request', `stage must be one of ${LEAD_STAGES.join(', ')}.`);

  const ok = await setLeadStage(auth.userId, id, stage);
  if (!ok) return apiError('not_found', 'No lead with that id.');
  await touchLeads(auth.userId, [id]);
  return apiJson({ id, stage });
}
