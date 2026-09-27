'use server';

import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { runBackfill, runRetention, setMetricsExclusion, type BackfillResult, type RetentionResult, type RunOutcome } from '@/lib/activity/admin-server';

const PAGE = '/admin/weekly-active';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${PAGE}`);
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

/** The "Exclude from metrics" switch: one account out of (or back into) every figure. */
export async function setExclusionAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const exclude = formData.get('exclude') === '1';
  const all = formData.get('all') === '1' ? '&all=1' : '';
  if (!UUID.test(id)) redirect(`${PAGE}?msg=failed${all}`);
  const ok = await setMetricsExclusion({ userId: id, exclude, by: user.email ?? user.id });
  revalidatePath(PAGE);
  redirect(`${PAGE}?msg=${ok ? (exclude ? 'excluded' : 'included') : 'failed'}${all}`);
}

export type BackfillState = { at: string; outcome: RunOutcome<BackfillResult> } | null;

/** The backfill: `apply` 0 is the dry run (counts only), 1 copies. Safe to repeat. */
export async function backfillAction(_prev: BackfillState, formData: FormData): Promise<BackfillState> {
  await requireAdmin();
  const apply = formData.get('apply') === '1';
  return { at: new Date().toISOString(), outcome: await runBackfill(apply) };
}

export type RetentionState = { at: string; outcome: RunOutcome<RetentionResult> } | null;

/** Counts what the nightly retention would delete. Never deletes. */
export async function retentionCheckAction(): Promise<RetentionState> {
  await requireAdmin();
  return { at: new Date().toISOString(), outcome: await runRetention({ apply: false }) };
}
