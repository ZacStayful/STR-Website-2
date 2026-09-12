import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { marketAccessState, type MarketAccessState } from '../market/access';
import { parseMarketGoals, type MarketGoals } from '../market/goals';
import { verifyExtensionToken } from './tokens';
import { getBalance } from '../credit/ledger';

/**
 * Who is calling /api/ext/*: the member behind the Bearer token, with the
 * same access rule as the explorer and the analyser (any member; paid
 * actions are charged to their credit). `state` is 'anon' for a missing or
 * revoked token.
 */
export interface ExtensionAccess {
  state: MarketAccessState;
  user: { id: string; email: string | null } | null;
  tokenId: string | null;
  planCode: string | null;
  /** Grant pence across every bucket (what the member sees as their balance). */
  balancePence: number | null;
  /** Base pence the balance covers after open reservations. */
  spendableBasePence: number | null;
  goals: MarketGoals | null;
}

const NONE: ExtensionAccess = { state: 'anon', user: null, tokenId: null, planCode: null, balancePence: null, spendableBasePence: null, goals: null };

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
  const { data: profile } = await createAdminClient().from('profiles').select('id, email, plan_code, market_goals').eq('id', token.userId).single();
  if (!profile) return { ...NONE, user: { id: token.userId, email: null }, tokenId: token.id, state: 'blocked' };
  const p = profile as { id: string; email: string | null; plan_code: string | null; market_goals: unknown };
  const balance = await getBalance(token.userId).catch(() => null);
  return {
    state: marketAccessState({ email: p.email }, p),
    user: { id: token.userId, email: p.email },
    tokenId: token.id,
    planCode: p.plan_code,
    balancePence: balance ? balance.totalPence : null,
    spendableBasePence: balance ? balance.spendableBasePence : null,
    goals: parseMarketGoals(p.market_goals),
  };
}
