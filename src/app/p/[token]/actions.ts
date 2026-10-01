'use server';

import { redirect } from 'next/navigation';
import { cleanReasons, isPickToken } from '@/lib/listing/picks';
import { addTypeFromPickFeedback, applyPickRelaxation, pickByToken, recordReaction, setPicksEnabled } from '@/lib/listing/picks-server';
import { logActivity, logActivityForPick } from '@/lib/activity/log';

// These run with no member session: the pick token in the email is the
// credential, exactly as a deal-sheet share token is. Every write is keyed on
// the token, and the token is validated before any query.

export async function submitPickFeedbackAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isPickToken(token)) redirect('/');
  const reaction = formData.get('reaction') === 'yes' ? 'yes' : 'no';
  await recordReaction({ token }, { reaction, source: 'form', reasons: formData.getAll('reasons').map(String), comment: formData.get('comment') });
  logActivityForPick(token, 'email_feedback', { extras: { answer: reaction, via: 'form', reasons: reaction === 'no' ? cleanReasons(formData.getAll('reasons')) : undefined } });
  // Batch 17 (Q25): "I want rent-to-rent, not to buy" adds the type to the pick's profile.
  const added = reaction === 'no' ? await addTypeFromPickFeedback({ token }, formData.getAll('reasons')) : null;
  // Batch 21 (E14): logged as the email answer it is, never as the qualifying
  // profile_edited: an answer from an email cannot make a member weekly active.
  if (added) logActivity(added.userId, 'email_feedback', { profileId: added.profileId, source: 'email_link', extras: { answer: reaction, via: 'form', question: 'deal_types', added: added.added } });
  redirect(`/p/${token}?a=${reaction}&thanks=1`);
}

export async function unsubscribePicksAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isPickToken(token)) redirect('/');
  const pick = await pickByToken(token);
  if (pick) await setPicksEnabled(pick.userId, false);
  if (pick) logActivity(pick.userId, 'email_settings', { source: 'email_link', extras: { key: 'daily_picks', on: false } });
  redirect(`/p/${token}?a=unsubscribe&done=1`);
}

/**
 * Accepts the filter change offered with a near-miss pick.
 *
 * No value is read from the form on purpose. The token is the credential and
 * it travels in an email, so the only safe thing to apply is the proposal
 * already stored on the pick row — see applyPickRelaxation.
 */
export async function applyRelaxationAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isPickToken(token)) redirect('/');
  const applied = await applyPickRelaxation(token);
  if (applied) logActivityForPick(token, 'email_settings', { extras: { key: 'pick_search', field: applied.field } });
  redirect(`/p/${token}?a=relaxed&done=${applied ? '1' : '0'}`);
}
