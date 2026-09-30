'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { parseLifecycleForm } from '@/lib/lifecycle/admin-form';
import { runMobileBackfill, type MobileBackfillOutcome } from '@/lib/credit/mobile-backfill-server';
import { runBackfill, runFunnelCron, type BackfillOutcome, type CronOutcome } from '@/lib/crm/monday-funnel/sync-server';

const PAGE = '/admin/lifecycle';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${PAGE}`);
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

export type SaveState = { ok: boolean; message: string } | null;

/** Batch 20's settings: the starter pack, the £5 decision and the inactivity rules. */
export async function saveLifecycleAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  await requireAdmin();
  const parsed = parseLifecycleForm((name) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  }, new Date());
  if (!parsed.ok) return { ok: false, message: parsed.message };
  try {
    for (const [key, value] of Object.entries(parsed.values)) await updateBillingSetting(key, value);
  } catch (err) {
    return { ok: false, message: `Not saved: ${err instanceof Error ? err.message : String(err)}` };
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Saved. ${parsed.summary.join('. ')}.` };
}

export type MobileState = { at: string; outcome: MobileBackfillOutcome } | null;

/** Part D: the dry run (apply 0) and the real run (apply 1). Safe to repeat. */
export async function mobileBackfillAction(_prev: MobileState, formData: FormData): Promise<MobileState> {
  await requireAdmin();
  const apply = formData.get('apply') === '1';
  return { at: new Date().toISOString(), outcome: await runMobileBackfill({ apply }) };
}

export type MondayState = { at: string; what: 'nightly_dry' | 'backfill_dry' | 'backfill'; nightly?: CronOutcome; backfill?: BackfillOutcome } | null;

/**
 * Part F: the nightly's dry run (inactivity and every row, whatever the hour;
 * writes nothing), the backfill's dry run, and the backfill itself.
 */
export async function mondayAction(_prev: MondayState, formData: FormData): Promise<MondayState> {
  await requireAdmin();
  const what = formData.get('what');
  const at = new Date().toISOString();
  if (what === 'nightly_dry') return { at, what, nightly: await runFunnelCron({ dry: true, nightly: 'force' }) };
  if (what === 'backfill') {
    const backfill = await runBackfill({ apply: true });
    revalidatePath(PAGE);
    return { at, what, backfill };
  }
  return { at, what: 'backfill_dry', backfill: await runBackfill({ apply: false }) };
}
