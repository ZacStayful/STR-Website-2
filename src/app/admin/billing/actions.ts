'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { syncUnitCosts, updateBillingSetting, updateUnitCost } from '@/lib/credit/unit-costs';
import { grant } from '@/lib/credit/ledger';

async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !isAdminEmail(data.user.email)) throw new Error('Not allowed');
  return { email: data.user.email! };
}

export type ActionState = { ok: boolean; message: string };

export async function updateUnitCostAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { email } = await requireAdmin();
    const provider = String(formData.get('provider') ?? '');
    const unit = String(formData.get('unit') ?? '');
    const unitCostPence = Number(formData.get('unit_cost_pence'));
    const markup = Number(formData.get('markup'));
    const notes = String(formData.get('notes') ?? '').trim();
    if (!provider || !unit || !Number.isFinite(unitCostPence) || unitCostPence < 0 || !Number.isFinite(markup) || markup <= 0) return { ok: false, message: 'Check the numbers.' };
    await updateUnitCost(provider, unit, { unitCostPence, markup, notes: notes || null }, email);
    revalidatePath('/admin/billing');
    return { ok: true, message: `${provider}:${unit} saved` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function updateRatesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const baseMarkup = Number(formData.get('base_markup'));
    const rates = { plan: Number(formData.get('rate_plan')), welcome: Number(formData.get('rate_welcome')), topup: Number(formData.get('rate_topup')), adjustment: Number(formData.get('rate_adjustment')) };
    const welcome = Number(formData.get('welcome_grant_pence'));
    const lowRatio = Number(formData.get('low_balance_ratio'));
    const referral = Number(formData.get('referral_pence'));
    if (![baseMarkup, welcome, lowRatio, referral, ...Object.values(rates)].every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, message: 'Check the numbers.' };
    await updateBillingSetting('base_markup', baseMarkup);
    await updateBillingSetting('spend_rates', rates);
    await updateBillingSetting('welcome_grant_pence', Math.round(welcome));
    await updateBillingSetting('low_balance_ratio', lowRatio);
    await updateBillingSetting('referral_pence', Math.round(referral));
    revalidatePath('/admin/billing');
    return { ok: true, message: 'Rates saved. New grants use the new spend rates; existing grants keep theirs.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function reseedUnitCostsAction(): Promise<ActionState> {
  try {
    await requireAdmin();
    const n = await syncUnitCosts();
    revalidatePath('/admin/billing');
    return { ok: true, message: `${n} row(s) added` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function grantAdjustmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { email } = await requireAdmin();
    const target = String(formData.get('email') ?? '').trim().toLowerCase();
    const pence = Math.round(Number(formData.get('pence')));
    const note = String(formData.get('note') ?? '').trim();
    if (!target || !Number.isFinite(pence) || pence === 0) return { ok: false, message: 'Email and a non-zero amount are required.' };
    const admin = createAdminClient();
    const { data: user } = await admin.from('profiles').select('id').ilike('email', target).limit(1).maybeSingle();
    if (!user) return { ok: false, message: `No account for ${target}` };
    await grant(String(user.id), 'adjustment', pence, { description: note || `Adjustment by ${email}`, sourceRef: `admin:${email}:${Date.now()}` });
    revalidatePath('/admin/billing');
    return { ok: true, message: `£${(pence / 100).toFixed(2)} ${pence > 0 ? 'added to' : 'removed from'} ${target}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function createPromoCodeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { email } = await requireAdmin();
    const code = String(formData.get('code') ?? '').toUpperCase().replace(/\s+/g, '');
    const pence = Math.round(Number(formData.get('pence')));
    const max = formData.get('max') ? Math.round(Number(formData.get('max'))) : null;
    const expires = String(formData.get('expires') ?? '').trim();
    if (!/^[A-Z0-9]{3,32}$/.test(code) || !Number.isFinite(pence) || pence <= 0) return { ok: false, message: 'Code (letters/digits) and a positive amount are required.' };
    const { error } = await createAdminClient().from('credit_codes').insert({ code, kind: 'promo', amount_pence: pence, max_redemptions: max && max > 0 ? max : null, expires_at: expires ? new Date(expires).toISOString() : null, created_by: email });
    if (error) return { ok: false, message: error.message };
    revalidatePath('/admin/billing');
    return { ok: true, message: `Code ${code} created` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function toggleCodeAction(code: string, active: boolean): Promise<ActionState> {
  try {
    await requireAdmin();
    const { error } = await createAdminClient().from('credit_codes').update({ active }).eq('code', code);
    if (error) return { ok: false, message: error.message };
    revalidatePath('/admin/billing');
    return { ok: true, message: `${code} ${active ? 'enabled' : 'disabled'}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
