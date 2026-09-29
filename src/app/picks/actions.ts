'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { parseMarketGoals } from '@/lib/market/goals';
import { cleanReasons } from '@/lib/listing/picks';
import { checkListingForMember } from '@/lib/listing/server';
import { addTypeFromPickFeedback, pickForMember, recordReaction, markPickSaved, pickProfileRow } from '@/lib/listing/picks-server';
import { createAdminClient } from '@/lib/supabase/admin';
import { myDealsFocusPath } from '@/lib/listing/return-path';
import { logActivity } from '@/lib/activity/log';

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
  if (pick.checkedListingId) redirect(myDealsFocusPath(`l-${pick.checkedListingId}`));

  // The pick's own profile's finance (Batch 13), else (untagged, or its profile deleted) the active profile's.
  const found = await pickProfileRow(createAdminClient(), id, user.id).catch(() => null);
  const own = found === 'gone' ? null : found;
  const { data: profile } = own ? { data: null } : await supabase.from('profiles').select('market_goals').eq('id', user.id).single();
  const goals = parseMarketGoals(own ? own.criteria : profile?.market_goals);
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
  logActivity(user.id, 'pick_saved', { dealId: pick.dealId, profileId: own?.id ?? null, extras: { item: `l-${checkedId}` } });
  // The deal's place on My deals (the Explorer's listings pane still takes old links).
  redirect(myDealsFocusPath(`l-${checkedId}`));
}

export async function reactToPickAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!UUID.test(id)) redirect('/picks');
  const { user } = await member();
  const reaction = formData.get('reaction') === 'yes' ? 'yes' : 'no';
  await recordReaction({ id, userId: user.id }, { reaction, source: 'form', reasons: formData.getAll('reasons').map(String), comment: formData.get('comment') });
  logActivity(user.id, 'pick_feedback', { extras: { answer: reaction, reasons: reaction === 'no' ? cleanReasons(formData.getAll('reasons')) : undefined } });
  // Batch 17 (Q25): "I want rent-to-rent, not to buy" adds the type to the pick's profile.
  const added = reaction === 'no' ? await addTypeFromPickFeedback({ id, userId: user.id }, formData.getAll('reasons')) : null;
  if (added) logActivity(user.id, 'profile_edited', { profileId: added.profileId, extras: { question: 'deal_types', via: 'pick_feedback', added: added.added } });
  const tab = String(formData.get('tab') ?? '');
  redirect(tab ? `/picks?tab=${encodeURIComponent(tab)}` : '/picks');
}
