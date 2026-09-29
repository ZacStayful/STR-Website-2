'use server';

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { runDemandSourcing } from '@/lib/sourcing-demand/run';
import { DEMAND_SETTING_KEYS, validateSettingsForm, type DemandSettings } from '@/lib/sourcing-demand/settings';
import { runDealCalibration } from '@/lib/deal-quality/calibrate-run';
import { runReportBackfill } from '@/lib/deal-quality/backfill-run';

// Mirrored in page.tsx: a 'use server' module may only export async functions.
const FLASH_COOKIE = 'sf_demand_flash';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/demand');
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

/** Stashes a short result for the page to show once, then goes back to it. */
async function flash(kind: string, body: Record<string, unknown>): Promise<never> {
  const jar = await cookies();
  // Lists and nested objects are dropped so the cookie stays under the size a browser keeps.
  const compact = Object.fromEntries(Object.entries(body).filter(([, v]) => v === null || typeof v !== 'object'));
  const value = Buffer.from(JSON.stringify({ kind, at: new Date().toISOString(), body: compact })).toString('base64url').slice(0, 3800);
  jar.set(FLASH_COOKIE, value, { maxAge: 300, path: '/admin/demand', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect('/admin/demand');
}

/** One real pass now, whatever DEMAND_SOURCING_ENABLED says; the cap and the threshold still apply. */
export async function runDemandPassAction(): Promise<void> {
  const user = await requireAdmin();
  const result = await runDemandSourcing({ dry: false, triggeredBy: user.email ?? 'admin' });
  await flash('pass', { status: result.status, ...(result.body as Record<string, unknown>) });
}

export async function updateDemandSettingsAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const r = validateSettingsForm((name) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  });
  if (!r.ok) return flash('settings', { error: r.error });
  try {
    for (const field of Object.keys(DEMAND_SETTING_KEYS) as (keyof DemandSettings)[]) await updateBillingSetting(DEMAND_SETTING_KEYS[field], r.settings[field]);
  } catch (err) {
    return flash('settings', { error: `Not saved: ${(err as Error)?.message ?? 'the settings could not be written'}` });
  }
  revalidatePath('/admin/demand');
  return flash('settings', { saved: true });
}

/**
 * Step 0 of the deal checks (Batch 16): the comparison with past full
 * analyses. "Dry run" lists what is left and the most it can cost, and
 * spends nothing; "Run" carries on where the last run stopped, within the
 * comparison's own ceiling. House spend.
 */
export async function runDealCalibrationAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const mode = formData.get('mode');
  // "Start again" keeps the case list and gives the comparison a fresh ceiling; it spends nothing itself.
  const reset = mode === 'reset';
  const dry = !reset && mode !== 'run';
  const result = await runDealCalibration({ dry, reset, triggeredBy: user.email ?? 'admin' });
  await flash(reset ? 'calibration-reset' : dry ? 'calibration-dry' : 'calibration', { status: result.status, ...(result.body as Record<string, unknown>) });
}

/**
 * Part D: the Monday backfill clean-up. "Dry run" counts what it would
 * remove, fill and geocode, and the cost; "Run" does it (duplicates archived
 * before they are deleted) and carries on where the last run stopped.
 */
export async function runReportBackfillAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const dry = formData.get('mode') !== 'run';
  const result = await runReportBackfill({ dry, triggeredBy: user.email ?? 'admin' });
  await flash(dry ? 'backfill-dry' : 'backfill', { status: result.status, ...(result.body as Record<string, unknown>) });
}
