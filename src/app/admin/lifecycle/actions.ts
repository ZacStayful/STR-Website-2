'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { parseLifecycleForm } from '@/lib/lifecycle/admin-form';
import { LIFECYCLE_KEYS, strandedByCutoverMove } from '@/lib/lifecycle/settings';
import { readStarterPackCutover, reopenWelcomeCheck } from '@/lib/lifecycle/settings-server';
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
  // A cutover moved later (or cleared) strands the accounts created in between:
  // no welcome credit and no pack. Their welcome check is reopened before the
  // save (nothing is saved if that fails; reopening early is harmless, the old
  // date just decides again) and once more after it, for anyone who signed in
  // in between.
  const before = await readStarterPackCutover();
  if (!before.ok) return { ok: false, message: 'Not saved: the current starter pack date could not be read. Try again.' };
  const stranded = strandedByCutoverMove(before.from, (parsed.values[LIFECYCLE_KEYS.starterPackFrom] as string) || null);
  if (stranded) {
    const first = await reopenWelcomeCheck(stranded);
    if (!first.ok) return { ok: false, message: `Not saved: the accounts created since the old starter pack date could not be given the welcome credit back (${first.error}). Try again.` };
  }
  try {
    for (const [key, value] of Object.entries(parsed.values)) await updateBillingSetting(key, value);
  } catch (err) {
    return { ok: false, message: `Not saved: ${err instanceof Error ? err.message : String(err)}` };
  }
  const notes = [...parsed.summary];
  if (stranded) {
    const again = await reopenWelcomeCheck(stranded);
    const span = `created from ${stranded.from}${stranded.to ? ` to ${stranded.to}` : ''}`;
    notes.push(again.ok ? `Accounts ${span} with no welcome credit and no pack get the welcome credit at their next sign-in` : `Warning: accounts ${span} who signed in during the save may need the save repeating (${again.error})`);
  }
  revalidatePath(PAGE);
  return { ok: true, message: `Saved. ${notes.join('. ')}.` };
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
