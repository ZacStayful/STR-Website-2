'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { mintApiKey, revokeApiKey } from '@/lib/api/keys';
import { parseScopes } from '@/lib/api/scopes';

/**
 * Minting and revoking API keys.
 *
 * The raw key is returned once, in the action's result, and never stored —
 * only its SHA-256 is. A customer who loses one mints another; there is no
 * way for us to show it again, which is the point.
 */

const UUID = /^[0-9a-f-]{36}$/i;

async function member(): Promise<{ id: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

export interface KeyState {
  error?: string;
  notice?: string;
  /** Shown once. */
  key?: string;
}

export async function mintKeyAction(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };

  const label = String(formData.get('label') ?? '').trim();
  // Checkboxes only appear in the FormData when ticked, so this is the set
  // the customer chose — parseScopes drops anything that is not real.
  const scopes = parseScopes(formData.getAll('scopes').map(String));
  if (scopes.length === 0) {
    return { error: 'Choose at least one thing this key may do.' };
  }

  const minted = await mintApiKey(who.id, label.length > 0 ? label : null, scopes);
  if (!minted) return { error: 'We could not create that key just now. Please try again.' };

  revalidatePath('/leads/api');
  return { key: minted.raw, notice: 'Copy this key now — it is not shown again.' };
}

export async function revokeKeyAction(_prev: KeyState, formData: FormData): Promise<KeyState> {
  const who = await member();
  if (!who) return { error: 'Please sign in again.' };

  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) return { error: 'That key no longer exists.' };

  const ok = await revokeApiKey(who.id, id);
  revalidatePath('/leads/api');
  // Revocation is immediate: the next request carrying it is refused.
  return ok ? { notice: 'Revoked. Anything still using it will stop working now.' } : { error: 'Could not revoke that key.' };
}
