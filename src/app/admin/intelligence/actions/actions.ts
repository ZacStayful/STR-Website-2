'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { ACTION_SETTING_KEYS, validateActionForm, type ActionSettings } from '@/lib/si-actions/settings';
import { flashAndGo } from '../flash';

const PAGE = '/admin/intelligence/actions';

async function requireAdmin(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${PAGE}`);
  if (!isAdminEmail(user.email)) notFound();
}

/** Batch 27: the Actions page's settings form. Every field is checked against its bounds before anything is saved. */
export async function saveActionSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const get = (name: string) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  };
  const r = validateActionForm(get);
  if (!r.ok) return flashAndGo(PAGE, { kind: 'error', message: r.error });
  for (const [field, key] of Object.entries(ACTION_SETTING_KEYS) as [keyof ActionSettings, string][]) {
    await updateBillingSetting(key, r.settings[field]);
  }
  revalidatePath(PAGE);
  return flashAndGo(PAGE, { kind: 'ok', message: 'Saved. The next instruction uses these.' });
}
