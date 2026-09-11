import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { marketAccessState, type MarketAccessState } from '../market/access';
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { verifyExtensionToken } from './tokens';

/**
 * Who is calling /api/ext/*: the member behind the Bearer token, with the
 * same access rule as the explorer and the analyser (Pro, trial with runs
 * left, admin). `state` is 'anon' for a missing or revoked token.
 */
export interface ExtensionAccess {
  state: MarketAccessState;
  user: { id: string; email: string | null } | null;
  tokenId: string | null;
  plan: 'free' | 'pro' | null;
  reportsRun: number | null;
  goals: MarketGoals | null;
}

const NONE: ExtensionAccess = { state: 'anon', user: null, tokenId: null, plan: null, reportsRun: null, goals: null };

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export async function extensionAccess(request: Request): Promise<ExtensionAccess> {
  const raw = bearerToken(request);
  if (!raw) return NONE;
  const token = await verifyExtensionToken(raw).catch(() => null);
  if (!token) return NONE;
  const { data: profile } = await createAdminClient().from('profiles').select('email, plan, reports_run, stripe_subscription_id, market_goals').eq('id', token.userId).single();
  if (!profile) return { ...NONE, user: { id: token.userId, email: null }, tokenId: token.id, state: 'blocked' };
  const p = profile as { email: string | null; plan: 'free' | 'pro'; reports_run: number; stripe_subscription_id: string | null; market_goals: unknown };
  return {
    state: marketAccessState({ email: p.email }, p),
    user: { id: token.userId, email: p.email },
    tokenId: token.id,
    plan: p.plan,
    reportsRun: p.reports_run,
    goals: parseMarketGoals(p.market_goals),
  };
}
