'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { emailKey } from '@/lib/supabase/email-key';
import { isAdminEmail } from '@/lib/admin';
import { getBillingSettings, getUnitCostTable, invalidateCreditCaches, syncUnitCosts, updateBillingSetting, updateUnitCost } from '@/lib/credit/unit-costs';
import { grant } from '@/lib/credit/ledger';
import { fullAnalysisRawCeiling } from '@/lib/credit/estimate';
import { MAX_RANGE_PCT } from '@/lib/credit/deal-pricing';
import { pickPrice } from '@/lib/listing/picks';
import { earliestPricingDate } from '@/lib/credit/pricing-date';

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

/** Batch 23b: the kill switch for AI morning briefings. Off: template openers for everyone, nothing charged. */
export async function updateBriefingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const on = formData.get('briefings_enabled') === 'on';
    await updateBillingSetting('briefings_enabled', on);
    revalidatePath('/admin/billing');
    return { ok: true, message: on ? 'AI briefings on.' : 'AI briefings off: template openers, nothing charged.' };
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
    // Batch 12: the profile completion credit and its "real answers" bar.
    const profilePence = Number(formData.get('profile_complete_pence'));
    const profileRealPct = Number(formData.get('profile_credit_min_real_pct'));
    if (![baseMarkup, welcome, lowRatio, referral, profilePence, profileRealPct, ...Object.values(rates)].every((n) => Number.isFinite(n) && n >= 0)) return { ok: false, message: 'Check the numbers.' };
    if (profileRealPct > 100) return { ok: false, message: 'The profile credit share is a percentage: 0 to 100.' };
    await updateBillingSetting('base_markup', baseMarkup);
    await updateBillingSetting('spend_rates', rates);
    await updateBillingSetting('welcome_grant_pence', Math.round(welcome));
    await updateBillingSetting('low_balance_ratio', lowRatio);
    await updateBillingSetting('referral_pence', Math.round(referral));
    await updateBillingSetting('profile_complete_pence', Math.round(profilePence));
    await updateBillingSetting('profile_credit_min_real_pct', Math.round(profileRealPct));
    revalidatePath('/admin/billing');
    return { ok: true, message: 'Rates saved. New grants use the new spend rates; existing grants keep the rate they were made at.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * Batch 10's fixed prices (src/lib/credit/deal-pricing.ts). A price that
 * would sit at or below what the thing can cost us is refused: the full
 * analysis against the worst-case raw cost of a report at today's unit
 * costs, the PMI add-on against its raw cost, daily deals against the pick
 * search behind them. The new-pricing date can only be one that gives every
 * member at least 14 days' notice (src/lib/credit/pricing-date.ts).
 */
export async function updateDealPricingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const num = (k: string) => Number(formData.get(k));
    const full = num('full_analysis_pence');
    const pmi = num('pmi_addon_pence');
    const daily = num('todays_5_daily_pence');
    const reuse = num('analysis_reuse_days');
    const plans = { starter: num('plan_starter'), pro: num('plan_pro'), scale: num('plan_scale'), pro_annual: num('plan_pro_annual') };
    const range = { high: num('range_high'), medium: num('range_medium'), low: num('range_low') };
    if (![full, pmi, daily, reuse, ...Object.values(plans)].every((n) => Number.isFinite(n) && n > 0)) return { ok: false, message: 'Every price must be above zero.' };
    if (!Object.values(range).every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_RANGE_PCT)) return { ok: false, message: `Range widths must be 0–${MAX_RANGE_PCT}%.` };
    const table = await getUnitCostTable();
    const ceiling = fullAnalysisRawCeiling(table, { priceLabs: process.env.PRICELABS_AS_PRIMARY === 'true' });
    if (full <= ceiling) return { ok: false, message: `A full analysis can cost us up to ${ceiling.toFixed(1)}p. The price must be above that.` };
    const ceilingPmi = fullAnalysisRawCeiling(table, { pmi: true, priceLabs: process.env.PRICELABS_AS_PRIMARY === 'true' });
    if (full + pmi <= ceilingPmi) return { ok: false, message: `With the second opinion a full analysis can cost us up to ${ceilingPmi.toFixed(1)}p. Full + PMI must be above that.` };
    const pickRaw = pickPrice(table).rawPence;
    if (daily <= pickRaw) return { ok: false, message: `A day of daily deals must cost more than the ${pickRaw}p search behind it.` };

    const rawDate = String(formData.get('new_pricing_from') ?? '').trim();
    let newPricingFrom: string | null = null;
    if (rawDate) {
      const at = Date.parse(`${rawDate}T00:00:00Z`);
      if (!Number.isFinite(at)) return { ok: false, message: 'That date is not a date.' };
      // The date already saved stays as it is, even once it has passed: only
      // a new or moved date must give members their 14 days, and never a date
      // before the one members were told (a later one is fine).
      invalidateCreditCaches();
      const saved = (await getBillingSettings()).dealPricing;
      const current = saved.newPricingPlanned;
      const unchanged = current !== null && current.slice(0, 10) === rawDate;
      if (!unchanged) {
        const earliest = await earliestPricingDate();
        if (at < earliest.getTime()) return { ok: false, message: `The new prices can start ${earliest.toISOString().slice(0, 10)} at the earliest: every member needs 14 days' notice (the notice email sets the clock).` };
        const told = saved.pricingNoticeFor ? Date.parse(saved.pricingNoticeFor) : NaN;
        if (Number.isFinite(told) && at < told) return { ok: false, message: `Members have been told the new prices start ${saved.pricingNoticeFor!.slice(0, 10)}. Choose that date or a later one.` };
      }
      newPricingFrom = new Date(at).toISOString();
    }

    await updateBillingSetting('full_analysis_pence', Math.round(full));
    await updateBillingSetting('pmi_addon_pence', Math.round(pmi));
    await updateBillingSetting('todays_5_daily_pence', Math.round(daily));
    await updateBillingSetting('analysis_reuse_days', Math.floor(reuse));
    await updateBillingSetting('plan_credit_pence', Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, Math.round(v)])));
    await updateBillingSetting('profit_range_pct', range);
    // '' rather than null: the column is jsonb NOT NULL, and '' reads back as "not set".
    await updateBillingSetting('new_pricing_from', newPricingFrom ?? '');
    revalidatePath('/admin/billing');
    return { ok: true, message: `Deal prices saved.${newPricingFrom ? ` New plan credit and daily deals from ${newPricingFrom.slice(0, 10)}, once the members' notice announcing it has gone out.` : ' No new-pricing date set.'}` };
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
    // Batch 21 (B37): the form's own nonce keys the grant, so a double submit
    // (or a resubmitted page) is a replay and grants once.
    const rawNonce = String(formData.get('nonce') ?? '');
    const nonce = /^[0-9a-f-]{8,64}$/i.test(rawNonce) ? rawNonce : crypto.randomUUID();
    if (!target || !Number.isFinite(pence) || pence === 0) return { ok: false, message: 'Email and a non-zero amount are required.' };
    const admin = createAdminClient();
    const { data: user } = await admin.from('profiles').select('id').eq('email', emailKey(target)).limit(1).maybeSingle();
    if (!user) return { ok: false, message: `No account for ${target}` };
    await grant(String(user.id), 'adjustment', pence, { description: note || `Adjustment by ${email}`, sourceRef: `admin:${email}:${nonce}` });
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

// ── The members' notice of the new prices (src/lib/credit/pricing-notice-run.ts) ──

export type NoticeActionResult = { ok: boolean; message: string; body: Record<string, unknown> | null };

/** Who would get the notice, what it says and whether it may go now. Sends nothing. */
export async function dryRunPricingNoticeAction(): Promise<NoticeActionResult> {
  try {
    await requireAdmin();
    const { runPricingNotice } = await import('@/lib/credit/pricing-notice-run');
    const res = await runPricingNotice({ dry: true });
    return { ok: res.status === 200, message: res.status === 200 ? 'Dry run done: nothing was sent.' : String(res.body.error ?? 'Dry run failed.'), body: res.body };
  } catch (err) {
    return { ok: false, message: (err as Error).message, body: null };
  }
}

/** Sends as many as fit in one press; press again for the rest. Refuses unless the date is at least 14 days away. */
export async function sendPricingNoticeAction(): Promise<NoticeActionResult> {
  try {
    await requireAdmin();
    const { runPricingNotice } = await import('@/lib/credit/pricing-notice-run');
    const res = await runPricingNotice({ dry: false });
    revalidatePath('/admin/billing');
    const b = res.body;
    return { ok: res.status === 200 && !b.error, message: b.error ? String(b.error) : `Sent ${b.sent ?? 0}, failed ${b.failed ?? 0}, ${b.remaining ?? 0} left.`, body: b };
  } catch (err) {
    return { ok: false, message: (err as Error).message, body: null };
  }
}

export type PdCheckResult = { ok: boolean; message: string; verdict?: string };

/** Batch 16, Part H: does PropertyData bill a failed call? One known-failing call, at most one credit. */
export async function propertyDataBillingCheckAction(): Promise<PdCheckResult> {
  try {
    const { email } = await requireAdmin();
    const { runPropertyDataFailedCallCheck } = await import('@/lib/broker/pd-billing-check');
    const r = await runPropertyDataFailedCallCheck(email);
    const credits = r.creditsBefore !== null ? ` Credits used: ${r.creditsBefore} before, ${r.creditsAfter ?? '?'} after; ${r.otherPaidCalls ?? '?'} other paid calls meanwhile.` : '';
    return { ok: r.verdict !== 'inconclusive', verdict: r.verdict, message: `${r.detail}${credits}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
