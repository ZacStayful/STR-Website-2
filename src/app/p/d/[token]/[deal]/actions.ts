'use server';

import { redirect } from 'next/navigation';
import { answerTeaser } from '@/lib/tailoring/email-answers-server';
import { isDealId, isEmailAnswer } from '@/lib/tailoring/email-answers';
import { isSendToken } from '@/lib/notify/cap';

/**
 * The one confirming POST behind an email's "Yes, more like this" / "Not for
 * me" (Batch 14, Part F). The token is the credential: the send's own, and
 * the deal must be one it carried. Everything is checked again here.
 */
export async function answerTeaserAction(formData: FormData): Promise<void> {
  const token = formData.get('token');
  const deal = formData.get('deal');
  const answer = formData.get('answer');
  if (!isSendToken(token) || !isDealId(deal) || !isEmailAnswer(answer)) redirect('/');
  const back = `/p/d/${encodeURIComponent(token)}/${deal}`;
  const res = await answerTeaser(token, deal, answer, formData.getAll('reasons'));
  if (!res.ok) redirect(`${back}?a=${answer}&error=${res.code}`);
  redirect(`${back}?done=${answer}`);
}
