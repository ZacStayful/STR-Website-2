import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { getLead } from '@/lib/api/leads-query';
import { enqueueDelivery } from '@/lib/crm/deliver';
import { touchLeads } from '@/lib/leads/activity';

export const dynamic = 'force-dynamic';

/**
 * Promotes a held lead into the customer's CRM.
 *
 * The promise behind the "hold" policy: a lead that missed the filter is
 * still theirs, and still theirs to change their mind about — from an agent
 * as much as from the UI.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'leads:write');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  // Read through the ownership-scoped path first: enqueueDelivery resolves
  // the owner off the lead itself, so without this a valid key could push
  // someone else's lead into its own CRM.
  const lead = await getLead(auth.userId, id);
  if (!lead) return apiError('not_found', 'No lead with that id.');
  if (!lead.lead.report.url) {
    return apiError('invalid_request', 'That lead has no report yet, so there is nothing to send.');
  }

  if (lead.archivedAt) {
    return apiError('invalid_request', 'That lead is archived. Restore it before sending it on.');
  }

  await touchLeads(auth.userId, [id]);
  const outcome = await enqueueDelivery({ leadId: id, immediate: true });
  if (!outcome.queued) {
    return apiError('invalid_request', 'No CRM is connected. Connect one under Integrations first.');
  }
  if (outcome.delivered && !outcome.delivered.ok) {
    // Queued and retrying, so this is not a failure the caller should treat
    // as final — but it should not be told the lead has landed either.
    return apiJson({ queued: true, delivered: false, error: outcome.delivered.error }, { status: 202 });
  }
  return apiJson({ queued: true, delivered: Boolean(outcome.delivered?.ok), crmItemId: outcome.delivered?.externalId ?? null });
}
