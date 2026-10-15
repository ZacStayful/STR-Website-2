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

let warnedUndecryptable = false;

/**
 * The webhook the Sync created: its id, its secret decrypted (null when it
 * can't be), and (R3-69) whether a stored secret failed to decrypt: this
 * deployment's CRM_ENCRYPTION_KEY is not the one it was kept with, which is
 * said once in the log and on every Dry run, never hidden behind "absent".
 */
export async function storedPostCallWebhook(): Promise<{ id: string; secret: string | null; undecryptable: boolean } | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient().from('billing_settings').select('value').eq('key', APP_WEBHOOK_KEY).maybeSingle();
  const v = (data as { value: unknown } | null)?.value as { id?: unknown; secret?: unknown } | null | undefined;
  if (!v || typeof v.id !== 'string' || !v.id) return null;
  const secret = typeof v.secret === 'string' ? decryptSecret(v.secret) : null;
  const undecryptable = typeof v.secret === 'string' && secret === null;
  if (undecryptable && !warnedUndecryptable) {
    warnedUndecryptable = true;
    console.error(`[voice] the stored post-call webhook secret (webhook ${v.id}) can't be decrypted with this deployment's CRM_ENCRYPTION_KEY: call results are refused until the key is put back or the webhook is remade by the Sync`);
  }
  return { id: v.id, secret, undecryptable };
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
