'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { dealVisibilityFor } from '@/lib/marketplace/tier';
import { setDealReaction } from '@/lib/marketplace/reactions-server';
import { logActivity } from '@/lib/activity/log';
import { primaryProfileFor } from '@/lib/profiles/server';
import { noteRevealKeep, revealRowFor } from '@/lib/intelligence/reveal-server';
import { revealNext } from '@/lib/intelligence/reveal';

/**
 * "Save all 3": a Keep on every revealed deal not answered yet. A plain form,
 * so it works before the page has finished loading. Only the deals the
 * member's reveal recorded can be saved this way.
 */
export async function saveAllAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/welcome/reveal');
  const back = revealNext(String(formData.get('back') ?? ''), '/welcome/reveal');
  const row = await revealRowFor(user.id);
  const wanted = formData.getAll('deal').map(String);
  const deals = (row?.dealIds ?? []).filter((id) => wanted.includes(id));
  const [visibility, profile] = await Promise.all([dealVisibilityFor(user.id, isAdminEmail(user.email)), primaryProfileFor(user.id)]);
  let first = true;
  for (const dealId of deals) {
    const outcome = await setDealReaction(user.id, dealId, 'keep', visibility, profile?.id ?? null);
    if (!outcome.ok) continue;
    const timing = first ? await noteRevealKeep(user.id) : null;
    first = false;
    logActivity(user.id, 'keep', { dealId, profileId: profile?.id ?? null, extras: { from: 'reveal', all: true, ...(timing ? { ms: timing.ms } : {}) } });
  }
  redirect(`${back}${back.includes('?') ? '&' : '?'}saved=all`);
}
