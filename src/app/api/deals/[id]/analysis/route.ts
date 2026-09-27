import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { startDealAnalysis } from '@/lib/analysis/deal-analysis';
import { analysisHttpStatus } from '@/lib/analysis/deal-analysis-rules';

/**
 * Starts a Full analysis of a feed deal (src/lib/analysis/deal-analysis.ts):
 * checks it can run, charges the Quick look when the deal is not open yet,
 * and holds the rest. The analysis itself runs from ./run.
 *
 * Body: { withPmi: boolean, quotedBasePence: number } — the price the member
 * confirmed. Any other price is refused (409 price_changed, with the new one).
 */
// Opening an unopened deal may read the listing page live before charging.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'We couldn’t find that deal.', code: 'missing' }, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in to run a Full analysis.', code: 'signed_out' }, { status: 401 });
  let body: { withPmi?: unknown; quotedBasePence?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid request body.', code: 'invalid' }, { status: 400 });
  }
  const outcome = await startDealAnalysis({ supabase, userId: user.id, adminUser: isAdminEmail(user.email), dealId: id, withPmi: body.withPmi === true, quotedBasePence: body.quotedBasePence });
  if (outcome.ok) return Response.json({ purchaseId: outcome.purchaseId, openedNow: outcome.openedNow });
  if (outcome.code === 'insufficient_credit' && outcome.requiredPence !== undefined) {
    const res = insufficientCreditResponse({ requiredPence: outcome.requiredPence, availablePence: outcome.availablePence ?? 0 }, 'full_analysis');
    const payload = (await res.json()) as Record<string, unknown>;
    return Response.json({ ...payload, error: outcome.message }, { status: 402 });
  }
  return Response.json({ error: outcome.message, code: outcome.code, ...(outcome.reportId ? { reportId: outcome.reportId } : {}), ...(outcome.quote ? { quote: outcome.quote } : {}) }, { status: analysisHttpStatus(outcome.code) });
}
