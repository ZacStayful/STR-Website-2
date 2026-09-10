import { getMarketAccess } from '@/lib/market/gate';
import { checkListingForMember } from '@/lib/listing/server';
import { parseMarketGoals } from '@/lib/market/goals';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 30;

/**
 * POST { url, save?: boolean, refresh?: boolean }
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

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase.from('profiles').select('market_goals').eq('id', access.user.id).single();
  const goals = parseMarketGoals(profile?.market_goals);

  const outcome = await checkListingForMember(url, { userId: access.user.id, goals, save: body.save !== false, refresh: body.refresh === true });
  if (!outcome.ok) {
    const status = outcome.code === 'unsupported_url' ? 400 : outcome.code === 'cap' ? 429 : 200;
    return Response.json({ error: outcome.message, code: outcome.code, detected: outcome.detected }, { status });
  }
  return Response.json(outcome.body);
}
