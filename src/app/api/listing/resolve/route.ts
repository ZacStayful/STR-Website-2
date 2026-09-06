import { getMarketAccess } from '@/lib/market/gate';
import { resolveListing, recordCheckedListing, resolvesToday } from '@/lib/listing/server';
import { quickEstimate } from '@/lib/listing/quick';
import { parseMarketGoals } from '@/lib/market/goals';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 30;

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

  const cap = Number(process.env.LISTING_RESOLVES_PER_DAY ?? DEFAULT_RESOLVES_PER_DAY);
  const used = await resolvesToday(access.user.id);
  if (Number.isFinite(cap) && cap > 0 && used >= cap) {
    return Response.json({ error: `You have checked ${cap} listings today. Try again tomorrow.` }, { status: 429 });
  }

  const resolved = await resolveListing(url, { refresh: body.refresh === true });
  if (!resolved.ok) return Response.json({ error: resolved.message, code: resolved.code, detected: resolved.detected }, { status: resolved.code === 'unsupported_url' ? 400 : 200 });

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from('profiles').select('market_goals').eq('id', access.user.id).single();
  const goals = parseMarketGoals(profile?.market_goals);
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
    { mode: 'quick', userId: access.user.id },
  );

  const checkedListingId = body.save === false ? null : await recordCheckedListing(access.user.id, snap, quick);
  return Response.json({ snapshot: snap, prefill: resolved.prefill, warnings: resolved.warnings, quick, checkedListingId, fromCache: resolved.fromCache });
}
