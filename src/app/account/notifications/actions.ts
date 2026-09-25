'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isNotificationKey } from '@/lib/notifications/registry';
import { setNotification } from '@/lib/notifications/server';

/**
 * Moves one switch. The key comes from the form but is validated against the
 * registry, and the write goes through the one notifications writer, so
 * nothing else in the app can put these columns in a state the panel does
 * not show.
 */
export async function setNotificationAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account/notifications');
  const key = formData.get('key');
  if (!isNotificationKey(key)) redirect('/account/notifications?msg=error');
  const on = formData.get('on') === '1';
  const ok = await setNotification(user.id, key, on);
  revalidatePath('/account/notifications');
  revalidatePath('/picks');
  revalidatePath('/markets');
  redirect(`/account/notifications?msg=${ok ? 'saved' : 'error'}`);
}
