'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { ukMonthKey } from '@/lib/funnels/tiers';

/**
 * Batch 22f: /admin/management's actions — the funnel-price notice (dry run,
 * then send) and setting an owner's month for testing the tiers.
 */

async function requireAdmin(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminEmail(data.user.email)) throw new Error('Not allowed');
}

export interface NoticeActionResult {
  ok: boolean;
  message: string;
  body?: Record<string, unknown>;
}

export async function dryRunFunnelNoticeAction(): Promise<NoticeActionResult> {
  try {
    await requireAdmin();
    const { runFunnelPriceNotice } = await import('@/lib/funnels/price-notice-run');
    const r = await runFunnelPriceNotice({ dry: true });
    return { ok: r.status === 200, message: r.status === 200 ? `Dry run: ${String(r.body.audience)} owners would get it.` : String(r.body.error ?? 'Failed'), body: r.body };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function sendFunnelNoticeAction(): Promise<NoticeActionResult> {
  try {
    await requireAdmin();
    const { runFunnelPriceNotice } = await import('@/lib/funnels/price-notice-run');
    const r = await runFunnelPriceNotice({ dry: false });
    revalidatePath('/admin/management');
    return { ok: r.status === 200 && !r.body.error, message: r.body.error ? String(r.body.error) : `Sent ${String(r.body.sent)}, failed ${String(r.body.failed)}, ${String(r.body.remaining)} left.`, body: r.body };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export type MonthState = { ok: boolean; message: string };

/**
 * For testing the tiers: sets an owner's charged-lead count for this UK month
 * (e.g. 20, so their next lead is the first at the second tier). It changes
 * what their next leads cost, so it says so; it never touches the ledger.
 */
export async function setTestMonthAction(_prev: MonthState, formData: FormData): Promise<MonthState> {
  try {
    await requireAdmin();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const leads = Number(formData.get('leads'));
    if (!email || !Number.isInteger(leads) || leads < 0 || leads > 100_000) return { ok: false, message: 'An email and a whole number of leads.' };
    const admin = createAdminClient();
    const { data: p } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
    if (!p) return { ok: false, message: 'No account with that email.' };
    const month = ukMonthKey();
    const { error } = await admin.from('funnel_lead_months').upsert({ owner_id: (p as { id: string }).id, month, leads, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,month' });
    if (error) return { ok: false, message: error.message };
    revalidatePath('/admin/management');
    return { ok: true, message: `${email}: ${leads} leads this month (${month}). Their next lead is number ${leads + 1}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
