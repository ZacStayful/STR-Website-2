import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseScopes, type Scope } from './scopes.ts';

/**
 * API keys for /api/v1/* and the MCP server.
 *
 * The same shape as the extension's tokens and for the same reason: the raw
 * key is shown once and only its SHA-256 is stored, so a database read can
 * never impersonate a customer. A separate table, though — the shipped
 * Chrome extension reads `extension_tokens` and must not be disturbed, and
 * these carry scopes it has no concept of.
 */

const KEY_PREFIX = 'sfk_';
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

export interface ApiKeyRow {
  id: string;
  label: string | null;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Mints a key and returns the raw value, which is never stored. */
export async function mintApiKey(
  userId: string,
  label: string | null,
  scopes: Scope[],
): Promise<{ raw: string; id: string } | null> {
  if (!hasServiceRole()) return null;
  const raw = KEY_PREFIX + randomBytes(32).toString('base64url');
  const { data, error } = await createAdminClient()
    .from('api_keys')
    .insert({
      user_id: userId,
      token_hash: hashKey(raw),
      label: label?.slice(0, 80) ?? null,
      // Cleaned rather than trusted: a typo must not become a scope, and an
      // unrecognised one must not be stored where a later version might read
      // it as meaningful.
      scopes: parseScopes(scopes),
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[api] key insert failed:', error?.message);
    return null;
  }
  return { raw, id: data.id as string };
}

/** Looks a raw key up. Null when unknown or revoked. */
export async function verifyApiKey(raw: string): Promise<{ id: string; userId: string; scopes: Scope[] } | null> {
  if (!hasServiceRole() || !raw.startsWith(KEY_PREFIX) || raw.length < 20 || raw.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('api_keys')
    .select('id, user_id, scopes, revoked_at, last_used_at')
    .eq('token_hash', hashKey(raw))
    .maybeSingle();
  if (!data || data.revoked_at) return null;

  const last = data.last_used_at ? new Date(data.last_used_at as string).getTime() : 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    // after(), not a floating promise: the serverless function can be frozen
    // before a detached write commits.
    after(async () => {
      const { error } = await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
      if (error) console.error('[api] last_used update failed:', error.message);
    });
  }
  return { id: data.id as string, userId: data.user_id as string, scopes: parseScopes(data.scopes) };
}

export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { error } = await createAdminClient()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) console.error('[api] revoke failed:', error.message);
  return !error;
}

/** The customer's live keys, newest first. Never the hashes. */
export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient()
    .from('api_keys')
    .select('id, label, scopes, created_at, last_used_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    label: (r.label as string | null) ?? null,
    scopes: parseScopes(r.scopes),
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  }));
}
