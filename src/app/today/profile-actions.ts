'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { collapseReminder } from '@/lib/profile/server';
import { logActivity } from '@/lib/activity/log';
import { quizPathFor } from '@/lib/auth/landing';
import { NAV_TARGETS } from '@/lib/nav';

/**
 * The profile reminder card on Today (Batch 12): "Continue" goes into the
 * quiz with Today as the way back; "Hide for today" folds it away until the
 * next Today-day. Whose card is always the session's.
 */
export async function tapProfileReminderAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) logActivity(user.id, 'profile_reminder_tapped');
  redirect(quizPathFor(NAV_TARGETS.today.href));
}

export async function collapseProfileReminderAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await collapseReminder(user.id, new Date());
  revalidatePath(NAV_TARGETS.today.href);
}
