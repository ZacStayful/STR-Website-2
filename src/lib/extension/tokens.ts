import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';

/**
 * Scoped tokens for the browser extension. The raw token is shown to the
 * member once (or handed straight to the extension); only its SHA-256 hash
 * is stored, so a database read can never impersonate a member.
 */

export interface ExtensionTokenRow {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const TOKEN_PREFIX = 'sfx_';
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function hasServiceRole(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Mints a new token for the member and returns the raw value (never stored). */
export async function mintExtensionToken(userId: string, label: string | null): Promise<{ raw: string; id: string } | null> {
  if (!hasServiceRole()) return null;
  const raw = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const { data, error } = await createAdminClient()
    .from('extension_tokens')
    .insert({ user_id: userId, token_hash: hashToken(raw), label: label?.slice(0, 80) ?? null })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[extension] token insert failed:', error?.message);
    return null;
  }
  return { raw, id: data.id as string };
}

/** Looks a raw token up; null when unknown or revoked. Touches last_used_at at most hourly. */
export async function verifyExtensionToken(raw: string): Promise<{ id: string; userId: string } | null> {
  if (!hasServiceRole() || !raw.startsWith(TOKEN_PREFIX) || raw.length < 20 || raw.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin.from('extension_tokens').select('id, user_id, revoked_at, last_used_at').eq('token_hash', hashToken(raw)).maybeSingle();
  if (!data || data.revoked_at) return null;
  const last = data.last_used_at ? new Date(data.last_used_at as string).getTime() : 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    void admin.from('extension_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(({ error }) => {
      if (error) console.error('[extension] last_used update failed:', error.message);
    });
  }
  return { id: data.id as string, userId: data.user_id as string };
}

export async function revokeExtensionToken(userId: string, tokenId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { error } = await createAdminClient().from('extension_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId).eq('user_id', userId).is('revoked_at', null);
  if (error) console.error('[extension] revoke failed:', error.message);
  return !error;
}

/** The member's live tokens, newest first (never the hashes). */
export async function listExtensionTokens(userId: string): Promise<ExtensionTokenRow[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient().from('extension_tokens').select('id, label, created_at, last_used_at').eq('user_id', userId).is('revoked_at', null).order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id as string, label: (r.label as string | null) ?? null, createdAt: r.created_at as string, lastUsedAt: (r.last_used_at as string | null) ?? null }));
}
