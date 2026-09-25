'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { openDeal, saveOpenedDealToPipeline } from '@/lib/marketplace/open';

const UUID = /^[0-9a-f-]{36}$/i;

async function member() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/deals');
  return { supabase, user, adminUser: isAdminEmail(user.email) };
}

/**
 * Open a deal sheet: verify the listing is still on the market, charge the
 * ladder price, unlock. Never from a bare link — the member presses the
 * button on the deal page.
 */
export async function openDealAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/deals?msg=missing');
  const { user, adminUser } = await member();
  let outcome;
  try {
    outcome = await openDeal({ userId: user.id, adminUser, dealId: id });
  } catch (err) {
    console.error('[deals] open failed:', err);
    redirect(`/deals/${encodeURIComponent(id)}?msg=failed`);
  }
  if (!outcome.ok) {
    if (outcome.code === 'missing') redirect('/deals?msg=missing');
    const extra = outcome.code === 'insufficient_credit' ? `&need=${outcome.requiredPence ?? 0}&have=${outcome.availablePence ?? 0}` : '';
    redirect(`/deals/${encodeURIComponent(id)}?msg=${outcome.code}${extra}`);
  }
  redirect(`/deals/${encodeURIComponent(id)}${outcome.alreadyOpen ? '' : '?msg=opened'}`);
}

export async function savePipelineAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/deals?msg=missing');
  const { user, adminUser } = await member();
  const result = await saveOpenedDealToPipeline(user.id, id, adminUser);
  if (!result.ok) redirect(`/deals/${encodeURIComponent(id)}?msg=${result.code === 'missing' ? 'missing' : result.code === 'not_open' ? 'not_open' : 'save_failed'}`);
  redirect(`/markets?pane=listings&listing=${encodeURIComponent(result.checkedListingId)}`);
}
