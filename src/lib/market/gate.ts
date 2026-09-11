import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import { ACCESS_COLUMNS } from '../access';
import { marketAccessState, type MarketAccessProfile, type MarketAccessState } from './access';

export interface MarketAccess {
  state: MarketAccessState;
  user: { id: string; email?: string | null } | null;
  profile: MarketAccessProfile | null;
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Resolves the current visitor's Market Explorer access once per request.
 *
 * Wrapped in React `cache` so the layout (which decides what chrome to show)
 * and every page under /markets (which must not fetch or render market data
 * unless access is 'ok') share one Supabase lookup. Pages MUST call this and
 * bail out before touching market data: Next renders page segments even when
 * the layout withholds `children`, so a layout-only gate would still put the
 * figures into the RSC payload.
 */
export const getMarketAccess = cache(async (): Promise<MarketAccess> => {
  if (!supabaseConfigured()) return { state: 'anon', user: null, profile: null };

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user ?? null;
  if (!user) return { state: 'anon', user: null, profile: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select(ACCESS_COLUMNS)
    .eq('id', user.id)
    .single();

  return { state: marketAccessState(user, profile ?? null), user, profile: profile ?? null };
});

/**
 * For pages under /markets. Sends signed-in users without access to /upgrade
 * with THEIR path as the return URL (so a deep link to an area survives the
 * paywall), and returns whether the page may render market data ('ok') or
 * must render the public product page instead ('anon').
 */
export async function requireMarketAccess(returnPath: string): Promise<'anon' | 'ok'> {
  const { state } = await getMarketAccess();
  if (state === 'blocked') redirect(`/upgrade?redirect=${encodeURIComponent(returnPath)}`);
  return state;
}
