import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { insufficientCreditResponse } from '@/lib/credit/http';
import { btlReportHttpStatus, runBtlReport } from '@/lib/btl/report-server';

/**
 * Batch 28, Part G: runs the £2 buy-to-let report (src/lib/btl/report-server.ts).
 * Body: { dealId } or { url } (a sale listing the member looked at), and
 * { quotedBasePence, quotedFacePence }: the price the member confirmed.
 * Charged once, only when the report is written; never on a failure.
 */
// A rent valuation retries (up to three attempts) beside the other checks.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.', code: 'signed_out' }, { status: 401 });
  let body: { dealId?: unknown; url?: unknown; quotedBasePence?: unknown; quotedFacePence?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* nothing to run on: refused below */
  }
  const dealId = typeof body.dealId === 'string' && /^[0-9a-f-]{36}$/i.test(body.dealId) ? body.dealId : null;
  const url = typeof body.url === 'string' && /^https:\/\//.test(body.url) ? body.url.slice(0, 500) : null;
  if (!dealId && !url) return Response.json({ error: 'We couldn’t find that listing.', code: 'missing' }, { status: 404 });
  const outcome = await runBtlReport({ userId: user.id, adminUser: isAdminEmail(user.email), target: { dealId, url }, quotedBasePence: body.quotedBasePence, quotedFacePence: body.quotedFacePence });
  if (outcome.ok) return Response.json({ ok: true, reportId: outcome.reportId, chargedBasePence: outcome.chargedBasePence });
  // Charged once: the report they already have on this listing opens instead.
  if (outcome.code === 'already_done' && outcome.reportId) return Response.json({ ok: true, reportId: outcome.reportId, chargedBasePence: 0, already: true });
  if (outcome.code === 'insufficient_credit' && outcome.requiredPence !== undefined) {
    const res = insufficientCreditResponse({ requiredPence: outcome.requiredPence, availablePence: outcome.availablePence ?? 0 }, 'btl_report');
    const payload = (await res.json()) as Record<string, unknown>;
    return Response.json({ ...payload, error: outcome.message }, { status: 402 });
  }
  return Response.json({ error: outcome.message, code: outcome.code, ...(outcome.pricePence !== undefined ? { pricePence: outcome.pricePence } : {}) }, { status: btlReportHttpStatus(outcome.code) });
}
