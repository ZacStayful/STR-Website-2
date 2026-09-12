import { getMarketAccess } from '@/lib/market/gate';
import { quickEstimate } from '@/lib/listing/quick';
import { normalisePostcode, parseMarketGoals } from '@/lib/market/goals';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { startAction } from '@/lib/credit/action';
import { runMetered } from '@/lib/credit/context';
import { estimateAction } from '@/lib/credit/estimate';
import { getUnitCostTable } from '@/lib/credit/unit-costs';
import { InsufficientCreditError } from '@/lib/credit/ledger';
import { insufficientCreditResponse } from '@/lib/credit/http';

// The quick view budgets its own lookups (see QUICK_BUDGET_MS); this is a backstop.
export const maxDuration = 60;

/**
 * POST { postcode?, outcode?, bedrooms, bathrooms?, lat?, lng?, airbnbId?, price?, kind }
 * The free quick view for an address or point (no listing URL needed).
 */
export async function POST(request: Request) {
  const access = await getMarketAccess();
  if (access.state === 'anon') return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (access.state !== 'ok' || !access.user) return Response.json({ error: 'Your plan does not include quick estimates.', upgradeUrl: '/upgrade' }, { status: 402 });

  let b: Record<string, unknown>;
  try {
    b = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const bedrooms = Number(b.bedrooms);
  if (!Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 10) return Response.json({ error: 'Bedrooms must be between 0 and 10.' }, { status: 400 });
  const postcode = typeof b.postcode === 'string' ? normalisePostcode(b.postcode) : null;
  const outcode = typeof b.outcode === 'string' && /^[A-Z]{1,2}\d[A-Z\d]?$/i.test(b.outcode.trim()) ? b.outcode.trim().toUpperCase() : postcode?.split(' ')[0] ?? null;
  if (!postcode && !outcode) return Response.json({ error: 'A postcode or outcode is required.' }, { status: 400 });
  const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
  const kind = b.kind === 'rent' ? 'rent' : b.kind === 'str' ? 'str' : 'sale';

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from('profiles').select('market_goals').eq('id', access.user.id).single();
  const goals = parseMarketGoals(profile?.market_goals);

  const member = access.user;
  const estimate = estimateAction(await getUnitCostTable(), 'quick_view');
  let action;
  try {
    action = await startAction({ userId: member.id, admin: isAdminEmail(member.email), action: 'quick_view', maxBasePence: estimate.maxBasePence });
  } catch (err) {
    if (err instanceof InsufficientCreditError) return insufficientCreditResponse(err, 'quick_view');
    throw err;
  }
  try {
    const quick = await runMetered(action.ctx, () =>
      quickEstimate(
        {
          kind,
          postcode,
          outcode,
          bedrooms,
          bathrooms: num(b.bathrooms, 1, 10) ?? undefined,
          lat: num(b.lat, 49, 61),
          lng: num(b.lng, -9, 3),
          airbnbId: typeof b.airbnbId === 'string' && /^\d{4,24}$/.test(b.airbnbId) ? b.airbnbId : null,
          price: num(b.price, 1, 50_000_000),
          finance: goals?.finance ?? null,
        },
        { mode: 'quick', userId: member.id },
      ),
    );
    return Response.json({ quick });
  } finally {
    await action.finish().catch(() => {});
  }
}
