'use server';

import { revalidatePath } from 'next/cache';
import { getMarketAccess } from '@/lib/market/gate';
import { mintExtensionToken, revokeExtensionToken } from '@/lib/extension/tokens';

export interface MintResult {
  token: string | null;
  error: string | null;
}

/** Mints a token for the signed-in member. Members without access get an upgrade message instead. */
export async function mintExtensionTokenAction(_prev: MintResult, formData: FormData): Promise<MintResult> {
  const access = await getMarketAccess();
  if (!access.user) return { token: null, error: 'Sign in first.' };
  if (access.state !== 'ok') return { token: null, error: 'Your plan does not include the browser extension. Upgrade to connect it.' };
  const labelRaw = formData.get('label');
  const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim().slice(0, 80) : 'Chrome';
  const minted = await mintExtensionToken(access.user.id, label);
  if (!minted) return { token: null, error: 'Could not create a token right now. Please try again.' };
  revalidatePath('/extension/connect');
  return { token: minted.raw, error: null };
}

export async function revokeExtensionTokenAction(tokenId: string): Promise<void> {
  const access = await getMarketAccess();
  if (!access.user || typeof tokenId !== 'string') return;
  await revokeExtensionToken(access.user.id, tokenId);
  revalidatePath('/extension/connect');
}
