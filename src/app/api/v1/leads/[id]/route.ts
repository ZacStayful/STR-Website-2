import { requireScope, isResponse, apiJson, apiError } from '@/lib/api/auth';
import { getLead } from '@/lib/api/leads-query';
import { deleteLead } from '@/lib/api/leads-write';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'leads:read');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const lead = await getLead(auth.userId, id);
  if (!lead) return apiError('not_found', 'No lead with that id.');
  return apiJson(lead);
}

/**
 * Erasure. The customer is the data controller for everyone who fills in
 * their funnel, so they need a working way to honour a deletion request —
 * this is that route, and it is why `leads` cascades its deliveries.
 *
 * The row is deleted outright rather than flagged. A "deleted" lead whose
 * personal data is still in the table is not erasure, whatever the UI says.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireScope(request, 'leads:write');
  if (isResponse(auth)) return auth;

  const { id } = await params;
  const ok = await deleteLead(auth.userId, id);
  if (!ok) return apiError('not_found', 'No lead with that id.');
  return apiJson({ deleted: true, id });
}
