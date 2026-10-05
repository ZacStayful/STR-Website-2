import 'server-only';

/**
 * The post-call webhook's signing secret. ElevenLabs shows a webhook's HMAC
 * secret only to whoever creates it, so the Sync (/admin/calls) creates the
 * webhook itself through the API and keeps the secret here, encrypted with
 * CRM_ENCRYPTION_KEY (src/lib/crypto/secrets.ts), never in plaintext.
 * ELEVENLABS_WEBHOOK_SECRET still works for a webhook made by hand.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { updateBillingSetting } from '../credit/unit-costs';
import { decryptSecret, encryptSecret } from '../crypto/secrets';
import { webhookSecret } from './config';

export const APP_WEBHOOK_KEY = 'si_post_call_webhook';

/** The webhook the Sync created: its id, and its secret decrypted (null when it can't be). */
export async function storedPostCallWebhook(): Promise<{ id: string; secret: string | null } | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient().from('billing_settings').select('value').eq('key', APP_WEBHOOK_KEY).maybeSingle();
  const v = (data as { value: unknown } | null)?.value as { id?: unknown; secret?: unknown } | null | undefined;
  if (!v || typeof v.id !== 'string' || !v.id) return null;
  return { id: v.id, secret: typeof v.secret === 'string' ? decryptSecret(v.secret) : null };
}

export async function savePostCallWebhook(id: string, secret: string): Promise<void> {
  await updateBillingSetting(APP_WEBHOOK_KEY, { id, secret: encryptSecret(secret), created_at: new Date().toISOString() });
}

/** Every secret a post-call request may be signed with: the env one (a webhook made by hand) and the Sync's. */
export async function postCallSecrets(): Promise<string[]> {
  const out: string[] = [];
  const env = webhookSecret();
  if (env) out.push(env);
  try {
    const stored = await storedPostCallWebhook();
    if (stored?.secret && !out.includes(stored.secret)) out.push(stored.secret);
  } catch (err) {
    console.error('[voice] post-call secret read failed:', err);
  }
  return out;
}
