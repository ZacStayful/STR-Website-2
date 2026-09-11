import { getMarketAccess } from '@/lib/market/gate';
import { resolveListing, recordCheckedListing, resolvesToday } from '@/lib/listing/server';
import { quickEstimate } from '@/lib/listing/quick';
import { parseMarketGoals } from '@/lib/market/goals';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Worst case is a slow portal fetch (12 s) + reverse geocode (6 s) + the
// quick view's own budget (~26 s across its serial steps); everything inside
// degrades to `limited` rather than hanging, so this ceiling is a backstop.
export const maxDuration = 60;

const DEFAULT_RESOLVES_PER_DAY = 30;

/**
 * POST { url, save?: boolean }
 * Members only (same rule as the explorer: Pro, trial with runs left, admin).
 * Never consumes a report run. Returns the parsed listing, the analyser
 * prefill and the free quick view, and records the listing against the member.
 */
export async function POST(request: Request) {
  const access = await getMarketAccess();
  if (access.state === 'anon') return Response.json({ error: 'Sign in to check a listing.' }, { status: 401 });
  if (access.state !== 'ok' || !access.user) return Response.json({ error: 'Your plan does not include listing checks.', upgradeUrl: '/upgrade' }, { status: 402 });

  let body: { url?: unknown; save?: unknown; refresh?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 2048) : '';
  if (!url) return Response.json({ error: 'Paste a listing link.' }, { status: 400 });

  try {
    const userId = access.user.id;
    const cap = Number(process.env.LISTING_RESOLVES_PER_DAY ?? DEFAULT_RESOLVES_PER_DAY);
    const [used, goals] = await Promise.all([resolvesToday(userId), loadGoals(userId)]);
    if (Number.isFinite(cap) && cap > 0 && used >= cap) {
      return Response.json({ error: `You have checked ${cap} listings today. Try again tomorrow.` }, { status: 429 });
    }

    const resolved = await resolveListing(url, { refresh: body.refresh === true });
    if (!resolved.ok) return Response.json({ error: resolved.message, code: resolved.code, detected: resolved.detected }, { status: resolved.code === 'unsupported_url' ? 400 : 200 });

    const snap = resolved.snapshot;
    const price = snap.kind === 'sale' ? resolved.prefill.purchasePrice : snap.kind === 'rent' ? resolved.prefill.advertisedRent : null;
    const quick = await quickEstimate(
      {
        kind: snap.kind,
        postcode: snap.postcode ?? null,
        outcode: snap.outcode ?? null,
        bedrooms: resolved.prefill.bedrooms,
        bathrooms: resolved.prefill.bathrooms,
        lat: snap.lat ?? null,
        lng: snap.lng ?? null,
        airbnbId: snap.source === 'airbnb' ? snap.id : null,
        price: price ?? null,
        finance: goals?.finance ?? null,
      },
      { mode: 'quick', userId },
    );

    const checkedListingId = body.save === false ? null : await recordCheckedListing(userId, snap, quick);
    return Response.json({ snapshot: snap, prefill: resolved.prefill, warnings: resolved.warnings, quick, checkedListingId, fromCache: resolved.fromCache });
  } catch (err) {
    console.error('[listing] resolve failed:', err);
    return Response.json({ error: 'We could not read that listing just now. Please try again in a moment.' }, { status: 500 });
  }
}

async function loadGoals(userId: string) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: profile } = await supabase.from('profiles').select('market_goals').eq('id', userId).single();
    return parseMarketGoals(profile?.market_goals);
  } catch {
    return null;
  }
}
