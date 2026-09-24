'use server';

import { redirect } from 'next/navigation';
import { isPickToken } from '@/lib/listing/picks';
import { applyPickRelaxation, pickByToken, recordReaction, setPicksEnabled } from '@/lib/listing/picks-server';

// These run with no member session: the pick token in the email is the
// credential, exactly as a deal-sheet share token is. Every write is keyed on
// the token, and the token is validated before any query.

export async function submitPickFeedbackAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isPickToken(token)) redirect('/');
  const reaction = formData.get('reaction') === 'yes' ? 'yes' : 'no';
  await recordReaction({ token }, { reaction, source: 'form', reasons: formData.getAll('reasons').map(String), comment: formData.get('comment') });
  redirect(`/p/${token}?a=${reaction}&thanks=1`);
}

export async function unsubscribePicksAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isPickToken(token)) redirect('/');
  const pick = await pickByToken(token);
  if (pick) await setPicksEnabled(pick.userId, false);
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
  redirect(`/p/${token}?a=relaxed&done=${applied ? '1' : '0'}`);
}
