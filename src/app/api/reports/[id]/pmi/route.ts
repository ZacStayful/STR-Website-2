import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { addSecondOpinion, pmiAddonHttpStatus } from '@/lib/analysis/pmi-addon';

/**
 * Adds the PMI second opinion to a finished Full analysis
 * (src/lib/analysis/pmi-addon.ts). Body: { quotedBasePence, quotedFacePence }
 * — the price the member confirmed, on a plan and from their own credit.
 */
// PMI can rate-limit and is retried once after ten seconds.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'We couldn’t find that report.', code: 'missing' }, { status: 404 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.', code: 'signed_out' }, { status: 401 });
  let body: { quotedBasePence?: unknown; quotedFacePence?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* no price confirmed: refused below */
  }
  const outcome = await addSecondOpinion({ supabase, userId: user.id, adminUser: isAdminEmail(user.email), reportId: id, quotedBasePence: body.quotedBasePence, quotedFacePence: body.quotedFacePence });
  if (outcome.ok) return Response.json({ ok: true, chargedBasePence: outcome.chargedBasePence });
  if (outcome.code === 'insufficient_credit' && outcome.requiredPence !== undefined) {
    const res = insufficientCreditResponse({ requiredPence: outcome.requiredPence, availablePence: outcome.availablePence ?? 0 }, 'pmi_addon');
    const payload = (await res.json()) as Record<string, unknown>;
    return Response.json({ ...payload, error: outcome.message }, { status: 402 });
  }
  return Response.json({ error: outcome.message, code: outcome.code, ...(outcome.pricePence !== undefined ? { pricePence: outcome.pricePence } : {}) }, { status: pmiAddonHttpStatus(outcome.code) });
}
