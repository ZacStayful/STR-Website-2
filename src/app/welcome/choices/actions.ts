'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { setNotification } from '@/lib/notifications/server';
import { logActivity } from '@/lib/activity/log';
import { hasVerifiedMobile, setSiCalls } from '@/lib/intelligence/consent';
import { markChoicesDone } from '@/lib/intelligence/reveal-server';
import { revealNext } from '@/lib/intelligence/reveal';

async function me() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/welcome/choices');
  return user;
}

/** The daily email's "Turn off" / "Turn on": the same writer as the Notifications panel. */
export async function setDailyEmailAction(formData: FormData): Promise<void> {
  const user = await me();
  const on = formData.get('on') === '1';
  const ok = await setNotification(user.id, 'daily_picks', on);
  if (ok) logActivity(user.id, 'notification_settings', { extras: { key: 'daily_picks', on, via: 'welcome' } });
  const next = revealNext(String(formData.get('next') ?? ''));
  revalidatePath('/welcome/choices');
  redirect(`/welcome/choices?next=${encodeURIComponent(next)}&email=${ok ? (on ? 'on' : 'off') : 'error'}`);
}

/**
 * "Continue": a ticked call box switches calls on (a verified mobile is
 * needed; without one the box is never ticked here — the code check runs
 * first). An unticked box saves nothing: calls stay off.
 */
export async function finishChoicesAction(formData: FormData): Promise<void> {
  const user = await me();
  const next = revealNext(String(formData.get('next') ?? ''));
  if (formData.get('calls') === '1' && (await hasVerifiedMobile(user.id)).verified) await setSiCalls(user.id, true, 'welcome');
  await markChoicesDone(user.id);
  redirect(next);
}
