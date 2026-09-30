import 'server-only';

import { createSupabaseServerClient } from '../supabase/server';
import { isAdminEmail } from '../admin';
import { authoriseInternal, internalSecretsConfigured } from '../internal-auth';

/**
 * Batch 20's one-off admin routes (the mobile and Monday backfills) answer to
 * the internal secret (a curl, n8n) or a signed-in admin (the browser).
 *
 * A write (POST) through an admin's session must come from this site: the
 * Origin header has to match, so another site cannot make an admin's browser
 * run a backfill. The secret needs no such check.
 */
export type AdminOrInternal = { ok: true; by: string; viaSession: boolean } | { ok: false; status: 404 | 403 };

export async function authoriseAdminOrInternal(request: Request): Promise<AdminOrInternal> {
  if (internalSecretsConfigured() && authoriseInternal(request)) return { ok: true, by: 'internal secret', viaSession: false };
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && isAdminEmail(user.email)) return { ok: true, by: user.email ?? user.id, viaSession: true };
  } catch {
    // No session to read: not an admin.
  }
  return { ok: false, status: 404 };
}

/** True when a session-authorised write came from this site's own pages. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
