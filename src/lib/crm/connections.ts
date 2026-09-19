import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { encryptSecret, decryptSecret, secretsConfigured } from '../crypto/secrets';
import { parseMondayConfig, mondayConfigBlockers } from './monday-map.ts';
import { checkWebhookUrl } from './providers/webhook.ts';
import { mintWebhookSecret } from './signature.ts';
import { isProviderId, providerFor } from './providers/index.ts';
import type { CrmProviderId, CrmResult, ResolvedConnection } from './types.ts';

/**
 * Reading and writing a customer's CRM connection.
 *
 * Every access is service-role. `crm_connections` is RLS-on with NO policy
 * at all — deliberately, because it holds credentials — so there is no path
 * from a browser session to a row, and the settings page reads through a
 * server component that returns a sanitised shape.
 *
 * Credentials are encrypted at rest with AES-256-GCM (crypto/secrets.ts).
 * Without CRM_ENCRYPTION_KEY configured, saving one FAILS rather than
 * falling back to plaintext: a customer's Monday token is a key to their
 * whole account, and storing it in the clear because a variable was missing
 * is not a degraded mode, it is a breach waiting to be found.
 */

export interface CrmConnectionRow {
  id: string;
  userId: string;
  provider: CrmProviderId;
  config: Record<string, unknown>;
  status: 'unverified' | 'ok' | 'error';
  lastOkAt: string | null;
  lastError: string | null;
  /** Whether a credential is stored — never the credential itself. */
  hasCredential: boolean;
  hasSecret: boolean;
  createdAt: string;
}

interface RawRow {
  id: string;
  user_id: string;
  provider: string;
  credential_enc: string | null;
  webhook_secret_enc: string | null;
  config: Record<string, unknown> | null;
  status: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  created_at: string;
}

const SAFE_COLUMNS = 'id, user_id, provider, config, status, last_ok_at, last_error, created_at, credential_enc, webhook_secret_enc';

function toRow(raw: RawRow): CrmConnectionRow {
  return {
    id: raw.id,
    userId: raw.user_id,
    provider: isProviderId(raw.provider) ? raw.provider : 'webhook',
    config: raw.config ?? {},
    status: raw.status === 'ok' || raw.status === 'error' ? raw.status : 'unverified',
    lastOkAt: raw.last_ok_at,
    lastError: raw.last_error,
    hasCredential: Boolean(raw.credential_enc),
    hasSecret: Boolean(raw.webhook_secret_enc),
    createdAt: raw.created_at,
  };
}

/** Everything a customer has connected. Credentials never leave this module. */
export async function listConnections(userId: string): Promise<CrmConnectionRow[]> {
  if (!hasServiceRole()) return [];
  const { data, error } = await createAdminClient()
    .from('crm_connections')
    .select(SAFE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[crm] list failed:', error.message);
    return [];
  }
  return (data as RawRow[] | null ?? []).map(toRow);
}

export async function getConnection(userId: string, id: string): Promise<CrmConnectionRow | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await createAdminClient()
    .from('crm_connections')
    .select(SAFE_COLUMNS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return toRow(data as RawRow);
}

/**
 * The full connection with its credential decrypted, for the delivery path.
 * `userId` is checked here too rather than only by the caller — this is the
 * one function that hands back a plaintext credential, so it verifies
 * ownership itself rather than trusting that someone else did.
 */
export async function resolveConnection(id: string, userId?: string): Promise<ResolvedConnection | null> {
  if (!hasServiceRole()) return null;
  let query = createAdminClient().from('crm_connections').select(SAFE_COLUMNS).eq('id', id);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const raw = data as RawRow;
  return {
    id: raw.id,
    userId: raw.user_id,
    provider: isProviderId(raw.provider) ? raw.provider : 'webhook',
    credential: decryptSecret(raw.credential_enc),
    webhookSecret: decryptSecret(raw.webhook_secret_enc),
    config: raw.config ?? {},
  };
}

/**
 * The connection a lead should be delivered to. One per customer in v1 —
 * a customer wiring up two CRMs at once is a want nobody has voiced, and
 * guessing at it would mean a delivery fan-out with twice the failure modes.
 */
export async function activeConnectionFor(userId: string): Promise<CrmConnectionRow | null> {
  const all = await listConnections(userId);
  // A verified connection wins over one that has never worked, so adding a
  // second, half-configured one cannot silently divert live leads.
  return all.find((c) => c.status === 'ok') ?? all[0] ?? null;
}

export interface SaveResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** Shown once, never retrievable again. */
  secret?: string;
}

/**
 * Creates or updates a connection. A blank credential LEAVES the stored one
 * alone rather than clearing it, so a customer editing their board id does
 * not have to paste their API token again — and cannot wipe it by accident.
 */
export async function saveConnection(input: {
  userId: string;
  id?: string | null;
  provider: CrmProviderId;
  config: Record<string, unknown>;
  /** Monday API token. Empty or absent keeps what is stored. */
  credential?: string | null;
  /** Mint a fresh webhook secret; the old one stops working immediately. */
  rotateSecret?: boolean;
}): Promise<SaveResult> {
  if (!hasServiceRole()) return { ok: false, error: 'Storage is not configured.' };

  const credential = typeof input.credential === 'string' ? input.credential.trim() : '';
  if (credential.length > 0 && !secretsConfigured()) {
    return { ok: false, error: 'Credential storage is not configured on this deployment. Ask us to set CRM_ENCRYPTION_KEY.' };
  }

  const patch: Record<string, unknown> = {
    user_id: input.userId,
    provider: input.provider,
    config: input.config,
    updated_at: new Date().toISOString(),
  };
  if (credential.length > 0) {
    patch.credential_enc = encryptSecret(credential);
    // A new credential invalidates whatever the last test proved.
    patch.status = 'unverified';
    patch.last_error = null;
  }

  let secret: string | undefined;
  const existing = input.id ? await getConnection(input.userId, input.id) : null;
  // A webhook without a secret is an unsigned webhook, so one is minted on
  // creation rather than waiting for the customer to ask for it.
  const needsSecret = input.provider === 'webhook' && (input.rotateSecret || !existing?.hasSecret);
  if (needsSecret) {
    if (!secretsConfigured()) {
      return { ok: false, error: 'Signing is not configured on this deployment. Ask us to set CRM_ENCRYPTION_KEY.' };
    }
    secret = mintWebhookSecret();
    patch.webhook_secret_enc = encryptSecret(secret);
  }

  const admin = createAdminClient();
  if (existing) {
    const { error } = await admin.from('crm_connections').update(patch).eq('id', existing.id).eq('user_id', input.userId);
    if (error) {
      console.error('[crm] update failed:', error.message);
      return { ok: false, error: 'Could not save that connection.' };
    }
    return { ok: true, id: existing.id, secret };
  }

  const { data, error } = await admin.from('crm_connections').insert(patch).select('id').single();
  if (error || !data) {
    console.error('[crm] insert failed:', error?.message);
    return { ok: false, error: 'Could not save that connection.' };
  }
  return { ok: true, id: data.id as string, secret };
}

export async function deleteConnection(userId: string, id: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { error } = await createAdminClient()
    .from('crm_connections')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) console.error('[crm] delete failed:', error.message);
  return !error;
}

/** Records what a test or a delivery proved, so the UI can show it. */
export async function recordConnectionResult(id: string, result: CrmResult): Promise<void> {
  if (!hasServiceRole()) return;
  await createAdminClient()
    .from('crm_connections')
    .update({
      status: result.ok ? 'ok' : 'error',
      last_ok_at: result.ok ? new Date().toISOString() : undefined,
      last_error: result.ok ? null : (result.error ?? 'Unknown error').slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/** Round-trips to the provider and stores the outcome. */
export async function testConnection(userId: string, id: string): Promise<CrmResult> {
  const conn = await resolveConnection(id, userId);
  if (!conn) return { ok: false, error: 'That connection no longer exists.' };
  const provider = providerFor(conn.provider);
  if (!provider) return { ok: false, error: 'That provider is no longer supported.' };
  const result = await provider.testConnection(conn);
  await recordConnectionResult(id, result);
  return result;
}

/**
 * What still stands between a connection and a working delivery, in the
 * customer's words. Shown on the settings page so they are never left with
 * a connection that looks saved and quietly does nothing.
 */
export function connectionBlockers(row: CrmConnectionRow): string[] {
  if (row.provider === 'monday') {
    const out = mondayConfigBlockers(parseMondayConfig(row.config));
    if (!row.hasCredential) out.unshift('Add your Monday API token.');
    return out;
  }
  const url = (row.config as { url?: unknown }).url;
  const check = checkWebhookUrl(typeof url === 'string' ? url : null);
  const out: string[] = [];
  if (!check.ok) out.push(check.reason ?? 'Add the URL your workflow listens on.');
  if (!row.hasSecret) out.push('Generate a signing secret.');
  return out;
}
