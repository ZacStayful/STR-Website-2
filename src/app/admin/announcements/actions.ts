'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { cleanAnnouncement } from '@/lib/feedback/announcements';
import { publishAnnouncement, saveAnnouncement, unpublishAnnouncement } from '@/lib/feedback/announcements-server';
import { saveFeedbackSettings } from '@/lib/feedback/settings-server';
import { parseSettings } from '@/lib/feedback/rules';
import { SETTING_KEYS } from '@/lib/feedback/config';

/**
 * /admin/announcements' actions (Batch 18). Each checks the admin itself and
 * answers with a message for the form to show.
 */
async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminEmail(data.user.email)) throw new Error('Not allowed');
  return { email: data.user.email! };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EditorState = { ok: boolean; message: string; errors?: Partial<Record<'kind' | 'title' | 'body' | 'link' | 'refs', string>> } | null;

function refresh(id?: string) {
  revalidatePath('/admin/announcements');
  if (id) revalidatePath(`/admin/announcements/${id}`);
}

/** Saves the draft (a new one first gets its own page). Publishing is separate. */
export async function saveAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  let createdId: string | null = null;
  try {
    const { email } = await requireAdmin();
    const rawId = String(formData.get('id') ?? '');
    const id = UUID.test(rawId) ? rawId : null;
    const clean = cleanAnnouncement({ kind: formData.get('kind'), title: formData.get('title'), body: formData.get('body'), link: formData.get('link'), refs: formData.get('refs') });
    if (!clean.ok) return { ok: false, message: 'Check the fields marked below.', errors: clean.errors };
    const res = await saveAnnouncement(clean.draft, id, email);
    if (!res.ok) return { ok: false, message: res.message };
    refresh(res.id);
    if (!id) createdId = res.id;
    else return { ok: true, message: 'Saved.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  redirect(`/admin/announcements/${createdId}?saved=1`);
}

export async function publishAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  try {
    await requireAdmin();
    const id = String(formData.get('id') ?? '');
    if (!UUID.test(id)) return { ok: false, message: 'Save it first.' };
    const res = String(formData.get('intent') ?? 'publish') === 'unpublish' ? await unpublishAnnouncement(id) : await publishAnnouncement(id);
    refresh(id);
    return res;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function maxAgeAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  try {
    await requireAdmin();
    const next = parseSettings(new Map<string, unknown>([[SETTING_KEYS.announcementMaxAgeDays, formData.get('days')]]));
    await saveFeedbackSettings({ announcementMaxAgeDays: next.announcementMaxAgeDays });
    refresh();
    return { ok: true, message: `Saved: announcements show for ${next.announcementMaxAgeDays} days after they are published.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
