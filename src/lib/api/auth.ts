import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getBalance } from '../credit/ledger';
import { verifyApiKey } from './keys';
import { hasScope, type Scope } from './scopes.ts';

/**
 * Who is calling /api/v1/* and the MCP server.
 *
 * Generalises `extensionAccess` over the scoped `api_keys` table. The shape
 * of a failure matters as much as the shape of a success here: an agent is
 * reading these errors, not a person, so every one carries a stable `code`
 * it can branch on rather than prose it would have to pattern-match.
 */

export interface ApiAccess {
  ok: boolean;
  user: { id: string; email: string | null } | null;
  keyId: string | null;
  scopes: Scope[];
  balancePence: number | null;
  spendableBasePence: number | null;
}

const NONE: ApiAccess = { ok: false, user: null, keyId: null, scopes: [], balancePence: null, spendableBasePence: null };

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

export async function apiAccess(request: Request): Promise<ApiAccess> {
  const raw = bearerToken(request);
  if (!raw) return NONE;
  const key = await verifyApiKey(raw).catch(() => null);
  if (!key) return NONE;

  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('id, email')
    .eq('id', key.userId)
    .maybeSingle();
  if (!profile) return NONE;

  const balance = await getBalance(key.userId).catch(() => null);
  return {
    ok: true,
    user: { id: key.userId, email: (profile as { email: string | null }).email },
    keyId: key.id,
    scopes: key.scopes,
    balancePence: balance ? balance.totalPence : null,
    spendableBasePence: balance ? balance.spendableBasePence : null,
  };
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'insufficient_credit'
  | 'rate_limited'
  | 'server_error';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  insufficient_credit: 402,
  rate_limited: 429,
  server_error: 500,
};

/**
 * Every failure looks the same. `code` is the contract; `message` is for a
 * human reading a log, and callers should never branch on it.
 */
export function apiError(code: ApiErrorCode, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message, ...extra } }, { status: STATUS[code] });
}

export function apiJson(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

export interface Authorised {
  access: ApiAccess;
  userId: string;
}

/**
 * The gate every v1 route opens with. Returns a Response to return as-is on
 * failure, or the caller's identity on success.
 *
 * The missing-scope error names the scope that was needed. An agent that
 * cannot tell WHICH permission it lacks can only report "forbidden" to its
 * user, who then has to guess which box to tick.
 */
export async function requireScope(request: Request, scope: Scope): Promise<Authorised | Response> {
  const access = await apiAccess(request);
  if (!access.ok || !access.user) {
    return apiError('unauthorized', 'Provide a valid API key as a Bearer token.');
  }
  if (!hasScope(access.scopes, scope)) {
    return apiError('forbidden', `This key does not have the "${scope}" scope.`, { requiredScope: scope });
  }
  return { access, userId: access.user.id };
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}
