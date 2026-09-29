'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeInternalPath } from '@/lib/safe-path';
import { GOALS_EDITOR_HREF } from '@/lib/nav';
import { createProfile, deleteProfile, renameProfile, setProfilePaused, switchProfile } from '@/lib/profiles/server';
import { typesFromForm } from '@/lib/profiles/rules';

/**
 * Saved profiles: every change is the signed-in member's own. Ids come from
 * the form but every write is scoped by the session's user id
 * (src/lib/profiles/server.ts), so a posted id that is not theirs changes
 * nothing. Each action ends on a page with a ?msg= line, like Notifications.
 */

const PAGE = '/profiles';

async function member(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${PAGE}`);
  return user.id;
}

const field = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === 'string' ? v : '';
};

function back(msg: string, error?: string): never {
  const q = new URLSearchParams({ msg });
  if (error) q.set('error', error);
  redirect(`${PAGE}?${q.toString()}`);
}

function refresh(): void {
  // Every members' page reads the active profile (the header, Today, the deal pages).
  revalidatePath('/', 'layout');
}

/** From the header menu or the profiles page: switch, and stay where you were (or go where asked). */
export async function switchProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  const out = await switchProfile(userId, field(formData, 'id'));
  if (!out.ok) back('error', out.error);
  refresh();
  redirect(safeInternalPath(field(formData, 'next'), '/today'));
}

/** "Edit" on a profile that is not the active one: switch to it, then the profile page edits it. */
export async function editProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  const out = await switchProfile(userId, field(formData, 'id'));
  if (!out.ok) back('error', out.error);
  refresh();
  redirect(GOALS_EDITOR_HREF);
}

/**
 * A new profile, copied from one the member has. It becomes the active one
 * and opens on the profile page, where anything different is changed.
 */
export async function createProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  const out = await createProfile({
    userId,
    name: field(formData, 'name'),
    copyFrom: field(formData, 'copy_from') || null,
    types: typesFromForm(formData.getAll('types')),
    forClient: field(formData, 'for_client') === '1',
  });
  if (!out.ok) back('error', out.error);
  const switched = await switchProfile(userId, out.id);
  refresh();
  if (!switched.ok) back('created');
  redirect(`${GOALS_EDITOR_HREF}?new=1`);
}

export async function renameProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  const out = await renameProfile(userId, field(formData, 'id'), field(formData, 'name'));
  if (!out.ok) back('error', out.error);
  refresh();
  back('renamed');
}

export async function pauseProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  const paused = field(formData, 'paused') === '1';
  const out = await setProfilePaused(userId, field(formData, 'id'), paused);
  if (!out.ok) back('error', out.error);
  refresh();
  const next = safeInternalPath(field(formData, 'next'), '');
  if (next) redirect(next);
  back(paused ? 'paused' : 'resumed');
}

export async function deleteProfileAction(formData: FormData): Promise<void> {
  const userId = await member();
  if (field(formData, 'confirm') !== '1') back('error', 'Tick the box to confirm.');
  const out = await deleteProfile(userId, field(formData, 'id'));
  if (!out.ok) back('error', out.error);
  refresh();
  back('deleted');
}
