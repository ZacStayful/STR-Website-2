import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseDateSetting } from '../credit/deal-pricing';
import { LIFECYCLE_KEYS } from './settings';

/**
 * The starter pack's cutover, read straight from billing_settings, for the
 * one decision that must not fall back to a default: whether a new account
 * gets the welcome credit. getBillingSettings() answers "not set" when the
 * table cannot be read, which here would hand £20 to a member the pack was
 * meant for; this says it could not tell instead, and the caller waits.
 */
export async function readStarterPackCutover(): Promise<{ ok: true; from: string | null } | { ok: false }> {
  if (!hasServiceRole()) return { ok: false };
  try {
    const { data, error } = await createAdminClient().from('billing_settings').select('value').eq('key', LIFECYCLE_KEYS.starterPackFrom).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, from: parseDateSetting((data as { value?: unknown } | null)?.value ?? null) };
  } catch {
    return { ok: false };
  }
}
