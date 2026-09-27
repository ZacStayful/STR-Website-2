import 'server-only';

/**
 * The PMI second opinion bought later, from a finished Full analysis
 * (POST /api/reports/[id]/pmi): billing_settings.pmi_addon_pence (£2 on a
 * plan), and nothing else. The analysis is not run again; a second opinion
 * PMI already gave for this property (the broker's 30-day cache, or the
 * saved analysis) is reused, otherwise PMI is asked once.
 *
 * Only a report made by a Full analysis of a feed deal can take one (a
 * report on a typed-in address is metered, and its enhanced run is chosen up
 * front). The purchase is claimed per report, so a double tap cannot buy it
 * twice, and the report is written only where it still has no opinion. PMI
 * not answering (a failure, an empty answer, the daily budget) costs nothing.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { createSupabaseServerClient } from '../supabase/server';
import { payerFor } from '../team';
import { getBillingSettings } from '../credit/unit-costs';
import { debit, getBalance, release, reserve, InsufficientCreditError } from '../credit/ledger';
import { isEnforcing } from '../credit/http';
import { afterDebit } from '../credit/after-debit';
import { startAction } from '../credit/action';
import { runMetered } from '../credit/context';
import type { AnalysisResult } from '../types';
import type { AnalysisInput } from './input';
import { enhancedEnabled, fetchSecondOpinion } from './run';
import { quoteMatches } from './deal-analysis-rules';
import { logActivity } from '../activity/log';
import type { SharedAnalysis } from './reuse';

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type PmiAddonCode = 'missing' | 'not_available' | 'already_done' | 'running' | 'seat_paused' | 'price_changed' | 'insufficient_credit' | 'unavailable' | 'no_opinion' | 'failed';

export type PmiAddonResult =
  | { ok: true; chargedBasePence: number }
  | { ok: false; code: PmiAddonCode; message: string; pricePence?: number; requiredPence?: number; availablePence?: number };

const MESSAGES: Record<PmiAddonCode, string> = {
  missing: 'We couldn’t find that report.',
  not_available: 'A second opinion from PMI can be added to a Full analysis of a deal in your feed.',
  already_done: 'This report already has a second opinion from PMI. Nothing was charged.',
  running: 'The second opinion is already on its way. Refresh in a moment.',
  seat_paused: 'Your seat on this team is paused, so you can’t spend the team’s credit.',
  price_changed: 'The price has changed since this page loaded. Nothing was charged; check the new price and try again.',
  insufficient_credit: 'Not enough credit for the second opinion. Nothing was charged.',
  unavailable: 'The PMI second opinion is switched off just now. Nothing was charged.',
  no_opinion: 'PMI couldn’t give a second opinion for this property just now, so nothing was charged. Please try again tomorrow.',
  failed: 'Something went wrong adding the second opinion. Nothing was charged; please try again.',
};

function fail(code: PmiAddonCode, extra: { pricePence?: number; requiredPence?: number; availablePence?: number } = {}): PmiAddonResult {
  return { ok: false, code, message: MESSAGES[code], ...extra };
}

export function pmiAddonHttpStatus(code: PmiAddonCode): number {
  if (code === 'missing') return 404;
  if (code === 'insufficient_credit' || code === 'seat_paused') return 402;
  if (code === 'already_done' || code === 'running' || code === 'price_changed') return 409;
  if (code === 'not_available' || code === 'unavailable') return 422;
  if (code === 'no_opinion') return 424;
  return 500;
}

export async function addSecondOpinion(input: { supabase: ServerClient; userId: string; adminUser: boolean; reportId: string; quotedBasePence: unknown }): Promise<PmiAddonResult> {
  if (!hasServiceRole()) return fail('failed');
  // The member's own client: a report they cannot read does not exist for them.
  const { data: report, error: readErr } = await input.supabase.from('saved_searches').select('id, deal_id, result').eq('id', input.reportId).maybeSingle();
  if (readErr) {
    console.error('[pmi-addon] report read failed:', readErr.message);
    return fail('failed');
  }
  if (!report) return fail('missing');
  const result = report.result as AnalysisResult | null;
  if (!report.deal_id || !result) return fail('not_available');
  if (result.secondOpinion) return fail('already_done');
  if (!enhancedEnabled(true)) return fail('unavailable');

  const admin = createAdminClient();
  // The inputs the analysis ran on come from the purchase that made it.
  const { data: made } = await admin.from('analysis_purchases').select('id, analysis_id, inputs').eq('report_id', input.reportId).eq('kind', 'full_analysis').eq('status', 'complete').limit(1);
  const full = ((made ?? []) as { id: string; analysis_id: string | null; inputs: AnalysisInput | null }[])[0];
  if (!full?.inputs) return fail('not_available');

  const payer = await payerFor(input.userId);
  if (payer.suspended) return fail('seat_paused');
  const pricing = (await getBillingSettings()).dealPricing;
  const price = input.adminUser ? 0 : pricing.pmiAddonPence;
  if (!quoteMatches(input.quotedBasePence, { purchaseBasePence: price })) return fail('price_changed', { pricePence: price });
  if (price > 0 && isEnforcing()) {
    const bal = await getBalance(payer.payerId).catch(() => null);
    const available = bal?.spendableBasePence ?? 0;
    if (available < price) return fail('insufficient_credit', { requiredPence: price, availablePence: Math.max(0, Math.round(available)) });
  }

  // ── Claim: one pending PMI purchase per report ──
  const { data: claimed, error: claimErr } = await admin
    .from('analysis_purchases')
    .insert({ user_id: payer.payerId, buyer_id: input.userId, kind: 'pmi_addon', status: 'pending', deal_id: report.deal_id, report_id: input.reportId, analysis_id: full.analysis_id, with_pmi: true, quoted_base_pence: price, pmi_base_pence: price, ready_at: new Date().toISOString(), run_started_at: new Date().toISOString() })
    .select('id')
    .single();
  if (claimErr?.code === '23505') return fail('running');
  if (claimErr || !claimed?.id) {
    console.error('[pmi-addon] claim failed:', claimErr?.message);
    return fail('failed');
  }
  const purchaseId = String(claimed.id);
  const finish = async (status: 'complete' | 'failed', extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from('analysis_purchases').update({ status, completed_at: new Date().toISOString(), ...extra }).eq('id', purchaseId).eq('status', 'pending');
    if (error) console.error('[pmi-addon] purchase update failed:', error.message);
  };

  let reservationId: string | null = null;
  if (price > 0) {
    try {
      reservationId = await reserve(payer.payerId, 'pmi_addon', purchaseId, price, 5);
    } catch (err) {
      if (err instanceof InsufficientCreditError && isEnforcing()) {
        await finish('failed', { failure: 'insufficient_credit' });
        return fail('insufficient_credit', { requiredPence: price, availablePence: Math.max(0, Math.round(err.availablePence)) });
      }
      console.warn('[pmi-addon] reservation not held:', (err as Error)?.message ?? err);
    }
  }

  try {
    // A second opinion the saved analysis already has costs no call.
    let opinion: AnalysisResult['secondOpinion'] = null;
    if (full.analysis_id) {
      const { data: savedRow } = await admin.from('deal_analyses').select('result').eq('id', full.analysis_id).maybeSingle();
      opinion = ((savedRow?.result as SharedAnalysis | null)?.result?.secondOpinion ?? null) as AnalysisResult['secondOpinion'];
    }
    if (!opinion) {
      const i = full.inputs;
      const action = await startAction({ userId: input.userId, admin: input.adminUser, action: 'pmi_addon', actionId: purchaseId, fixedPrice: true });
      try {
        const outcome = await runMetered(action.ctx, () => fetchSecondOpinion({ postcode: i.property.postcode, bedrooms: i.property.bedrooms, bathrooms: i.bathrooms, propertyType: i.propertyType }, { mode: 'full', userId: input.userId }));
        opinion = outcome.value;
      } finally {
        await action.finish();
      }
      if (opinion && full.analysis_id) {
        const { data: savedRow } = await admin.from('deal_analyses').select('result').eq('id', full.analysis_id).maybeSingle();
        const shared = savedRow?.result as SharedAnalysis | null;
        if (shared?.result) {
          const { error } = await admin.from('deal_analyses').update({ result: { ...shared, result: { ...shared.result, secondOpinion: opinion } }, has_second_opinion: true, second_opinion_at: new Date().toISOString() }).eq('id', full.analysis_id).eq('has_second_opinion', false);
          if (error) console.error('[pmi-addon] saved analysis update failed:', error.message);
        }
      }
    }
    if (!opinion) {
      await finish('failed', { failure: 'no opinion', second_opinion: false });
      await release(reservationId);
      return fail('no_opinion');
    }

    // Written only where the report still has none: a racing second tab cannot pay twice.
    const { data: written, error: writeErr } = await admin
      .from('saved_searches')
      .update({ result: { ...result, secondOpinion: opinion, enhancedNotice: null } })
      .eq('id', input.reportId)
      // ->> reads a stored JSON null as SQL null too (a standard report has "secondOpinion": null).
      .is('result->>secondOpinion', null)
      .select('id');
    if (writeErr) {
      console.error('[pmi-addon] report write failed:', writeErr.message);
      await finish('failed', { failure: 'report write' });
      await release(reservationId);
      return fail('failed');
    }
    if ((written ?? []).length === 0) {
      await finish('failed', { failure: 'already had one' });
      await release(reservationId);
      return fail('already_done');
    }

    const { data: calls } = await admin.from('provider_calls').select('cost_pence').eq('action_id', purchaseId);
    const rawCost = ((calls ?? []) as { cost_pence: number | null }[]).reduce((sum, r) => sum + (Number(r.cost_pence) || 0), 0);
    let txId: number | null = null;
    if (price > 0) {
      try {
        txId = await debit(payer.payerId, price, {
          reservationId,
          allowNegative: true,
          meta: { action: 'pmi_addon', action_id: purchaseId, provider: 'pmi', unit: 'pmi_addon', quantity: 1, unit_cost_pence: 0, markup: 1, raw_cost_pence: rawCost, description: 'Second opinion from PMI', deal_id: report.deal_id, report_id: input.reportId, ...(payer.memberId ? { member_id: payer.memberId } : {}) },
        });
      } catch (err) {
        console.error(`[pmi-addon] debit failed for purchase ${purchaseId}:`, err);
      }
    }
    await release(reservationId);
    if (txId !== null) void afterDebit(payer.payerId).catch(() => {});
    await finish('complete', { second_opinion: true, transaction_ids: txId === null ? [] : [txId], charged_base_pence: txId === null ? 0 : price });
    // At purchase, PMI is on the full_analysis event instead (one event per confirm).
    logActivity(input.userId, 'pmi_addon', { dealId: String(report.deal_id), dedupeKey: `pmi_addon:${input.reportId}`, extras: { from: 'report' } });
    return { ok: true, chargedBasePence: txId === null ? 0 : price };
  } catch (err) {
    console.error('[pmi-addon] failed:', err);
    await finish('failed', { failure: (err as Error)?.message?.slice(0, 200) ?? 'threw' });
    await release(reservationId);
    return fail('failed');
  }
}
