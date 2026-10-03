'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { hasServiceRole } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity/log';
import { deleteAllFacts, deleteFact } from '@/lib/knowledge/facts-server';

/**
 * Batch 24: a member deletes what Stayful Intelligence remembers about them,
 * for good. Only ever their own: the signed-in user's id is the filter, never
 * anything from the form but the fact's id.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signedIn(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/account');
  return user.id;
}

export async function deleteFactAction(formData: FormData): Promise<void> {
  const userId = await signedIn();
  const id = formData.get('id');
  if (typeof id !== 'string' || !UUID.test(id) || !hasServiceRole()) return;
  if (await deleteFact(userId, id)) logActivity(userId, 'si_fact_deleted', { extras: { all: false } });
  revalidatePath('/account');
}

export async function deleteAllFactsAction(): Promise<void> {
  const userId = await signedIn();
  if (!hasServiceRole()) return;
  const n = await deleteAllFacts(userId);
  if (n > 0) logActivity(userId, 'si_fact_deleted', { extras: { all: true, count: n } });
  revalidatePath('/account');
}
