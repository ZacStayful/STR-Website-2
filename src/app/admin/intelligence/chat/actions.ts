'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { CHAT_SETTING_KEYS, validateChatForm, type ChatSettings } from '@/lib/chat/settings';
import { flashAndGo } from '../flash';

const PAGE = '/admin/intelligence/chat';

async function requireAdmin(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${PAGE}`);
  if (!isAdminEmail(user.email)) notFound();
}

/** Batch 26: the Chat page's settings form. Every field is checked against its bounds before anything is saved. */
export async function saveChatSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const get = (name: string) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  };
  const r = validateChatForm(get);
  if (!r.ok) return flashAndGo(PAGE, { kind: 'error', message: r.error });
  for (const [field, key] of Object.entries(CHAT_SETTING_KEYS) as [keyof ChatSettings, string][]) {
    await updateBillingSetting(key, r.settings[field]);
  }
  revalidatePath(PAGE);
  return flashAndGo(PAGE, { kind: 'ok', message: 'Saved. The next question uses these; the box and its price hints follow within a minute.' });
}
