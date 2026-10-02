'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { ownerIdOrNull } from '@/lib/leads/scope';
import { recordActivity } from '@/lib/activity/log';
import { getFunnel } from '@/lib/funnels';
import { snoozeStarterPack } from '@/lib/starter-pack/server';
import { sendLeadReportEmail } from '@/lib/email/lead-report';
import { isSnippetKind } from '@/lib/funnels/snippets';
import { siteUrl } from '@/lib/url';

/**
 * Batch 22f: the guided setup's own bookkeeping. Saving the funnel itself is
 * never done here: every save goes through src/app/leads/actions.ts, the one
 * way a funnel is saved.
 */

async function owner(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const ownerId = await ownerIdOrNull(user);
  return ownerId && user ? { id: ownerId, email: user.email ?? null } : null;
}

/** A step finished (0: the pack bought or put off; 1–3 the steps). Once each. */
export async function recordSetupStepAction(step: number): Promise<void> {
  const who = await owner();
  if (!who || !Number.isInteger(step) || step < 0 || step > 3) return;
  await recordActivity(who.id, 'funnel_setup_step', { dedupeKey: `funnel_setup_step:${step}`, extras: { step } });
  revalidatePath('/leads/setup', 'layout');
}

/** "Not now" on the pack: the same snooze Today uses, then on to step 1. */
export async function skipPackAction(): Promise<void> {
  const who = await owner();
  if (!who) return;
  await snoozeStarterPack(who.id, 'setup');
  await recordActivity(who.id, 'funnel_setup_step', { dedupeKey: 'funnel_setup_step:0', extras: { step: 0, pack: 'not_now' } });
  revalidatePath('/leads/setup', 'layout');
}

/** Copy pressed on the link, the button or the embed. */
export async function recordSnippetAction(kind: string): Promise<void> {
  const who = await owner();
  if (!who || !isSnippetKind(kind)) return;
  await recordActivity(who.id, 'funnel_snippet_copied', { extras: { kind } });
}

/** How many demo emails a funnel's owner may send themselves a UK day. */
const DEMO_EMAILS_PER_DAY = 3;

export interface DemoState {
  sent?: boolean;
  error?: string;
}

/**
 * "See what a landlord gets": the landlord's own branded email, with the
 * demo report, sent to the owner's login address only. Free; three a day.
 */
export async function emailDemoAction(_prev: DemoState, formData: FormData): Promise<DemoState> {
  const who = await owner();
  if (!who || !who.email) return { error: 'Please sign in again.' };
  const id = String(formData.get('id') ?? '');
  const funnel = await getFunnel(who.id, id);
  if (!funnel) return { error: 'That form could not be found.' };
  if (hasServiceRole()) {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const { count } = await createAdminClient().from('activity_events').select('id', { count: 'exact', head: true }).eq('user_id', who.id).eq('kind', 'funnel_demo_emailed').gte('occurred_at', since);
    if ((count ?? 0) >= DEMO_EMAILS_PER_DAY) return { error: 'You have sent yourself the demo three times today. Try again tomorrow.' };
  }
  const ok = await sendLeadReportEmail({
    to: who.email,
    brand: funnel.brand,
    // The owner's own preview of the demo report (it opens for them only, signed in).
    reportUrl: siteUrl(`/f/${funnel.publicToken}?preview=report`),
    address: '803 Eastbank Tower, M4 (sample)',
  });
  if (!ok) return { error: 'We could not send that just now. Please try again.' };
  await recordActivity(who.id, 'funnel_demo_emailed', { extras: { funnel: funnel.id } });
  return { sent: true };
}
