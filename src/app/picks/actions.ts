'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { parseMarketGoals } from '@/lib/market/goals';
import { checkListingForMember } from '@/lib/listing/server';
import { pickForMember, recordReaction, markPickSaved, setPicksEnabled } from '@/lib/listing/picks-server';

const UUID = /^[0-9a-f-]{36}$/i;

async function member() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/picks');
  return { supabase, user };
}

/**
 * Save a pick to the deal pipeline: the same listing check as pasting the
 * link into the explorer (quick view, charged as quick_view, daily cap), so
 * the pipeline row is a real checked listing that the re-check cron keeps
 * fresh. Never runs from a link: the member clicks Save on the page.
 */
export async function savePickAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/picks?msg=missing');
  const { supabase, user } = await member();
  const pick = await pickForMember(id, user.id);
  if (!pick) redirect('/picks?msg=missing');
  if (pick.checkedListingId) redirect(`/markets?pane=listings&listing=${encodeURIComponent(pick.checkedListingId)}`);

  const { data: profile } = await supabase.from('profiles').select('market_goals').eq('id', user.id).single();
  const goals = parseMarketGoals(profile?.market_goals);
  let outcome;
  try {
    outcome = await checkListingForMember(pick.listing.canonicalUrl, { userId: user.id, goals, save: true, adminUser: isAdminEmail(user.email) });
  } catch (err) {
    console.error('[picks] save failed:', err);
    redirect('/picks?msg=failed');
  }
  if (!outcome.ok) redirect(`/picks?msg=${encodeURIComponent(outcome.code)}&pick=${encodeURIComponent(id)}`);
  const checkedId = outcome.body.checkedListingId;
  if (!checkedId) redirect('/picks?msg=failed');
  await markPickSaved(id, user.id, checkedId);
  redirect(`/markets?pane=listings&listing=${encodeURIComponent(checkedId)}`);
}

export async function reactToPickAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/picks');
  const { user } = await member();
  const reaction = formData.get('reaction') === 'yes' ? 'yes' : 'no';
  await recordReaction({ id, userId: user.id }, { reaction, source: 'form', reasons: formData.getAll('reasons').map(String), comment: formData.get('comment') });
  const tab = String(formData.get('tab') ?? '');
  redirect(tab ? `/picks?tab=${encodeURIComponent(tab)}` : '/picks');
}

export async function togglePicksAction(formData: FormData): Promise<void> {
  const { user } = await member();
  await setPicksEnabled(user.id, formData.get('on') === '1');
  redirect('/picks');
}
