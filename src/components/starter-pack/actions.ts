'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { recordPackShown, snoozeStarterPack } from '@/lib/starter-pack/server';
import { logActivity } from '@/lib/activity/log';

/**
 * The starter pack's taps (Batch 20). Being shown the offer and "Not now" are
 * recorded only: neither counts towards weekly active. Buying is the
 * /api/billing/starter-pack route.
 */

async function signedInUser(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** The offer came on screen (the welcome screen, the out-of-credit modal). Once a day per surface. */
export async function packShownAction(surface: string): Promise<void> {
  const userId = await signedInUser();
  if (userId) recordPackShown(userId, surface);
}

/** "Not now" on the welcome screen or a dead end: recorded, nothing hidden. */
export async function packNotNowAction(surface: string): Promise<void> {
  const userId = await signedInUser();
  if (userId) logActivity(userId, 'starter_pack_not_now', { extras: { surface: surface === 'welcome' || surface === 'modal' || surface === 'deal' ? surface : 'other' } });
}

/** "Not now" on the Today card: hidden for the snooze days (billing_settings.starter_pack_snooze_days). */
export async function snoozePackAction(): Promise<void> {
  const userId = await signedInUser();
  if (!userId) return;
  await snoozeStarterPack(userId, 'today');
  revalidatePath('/today');
}
