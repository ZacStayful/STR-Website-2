import 'server-only';

/**
 * A Full analysis of a deal in the feed, bought at a fixed price
 * (billing_settings.full_analysis_pence, £4 on a plan) instead of metered per
 * provider call. Two requests: a deal that is not open yet may have its
 * listing page read before anything is charged, and the analysis itself needs
 * most of a function's minute on its own.
 *
 * START (POST /api/deals/[id]/analysis): nothing is charged until step 4.
 *  1. The deal, the account's open and any analysis the member can already
 *     read are looked up, and the fixed inputs are worked out from the
 *     listing (deal-input.ts). No full postcode, or a rental without its
 *     rent: it stops here.
 *  2. The price (analysisQuote) must be the one the member confirmed on the
 *     button; otherwise the new price goes back to be confirmed.
 *  3. A pending analysis_purchases row is claimed: one per account and deal,
 *     so a double tap or a second tab gets "already running".
 *  4. A deal not open to the account is opened exactly as a Quick look is
 *     (openDeal: checked live first, the ladder price charged, "just gone"
 *     costs nothing). What the account paid to open it comes off the price.
 *  5. The rest (analysis + PMI) is reserved against the balance.
 *
 * RUN (POST /api/deals/[id]/analysis/run, streamed):
 *  6. A saved analysis of the deal on the same inputs, younger than
 *     analysis_reuse_days, is reused (reuse.ts): no provider is paid again,
 *     except PMI when it was asked for and the saved one has none. Otherwise
 *     the analysis runs under a fixed-price meter: every provider call logged
 *     with its cost, none debited.
 *  7. Complete means short-let figures came back AND the report saved. Only
 *     then is the rest debited (full_analysis), and PMI only if it answered
 *     (pmi_addon), both against the reservation.
 *  8. Anything else: nothing more is charged, the purchase is marked failed
 *     and the member can try again. A Quick look charged in step 4 stays
 *     charged, because the deal is open to them for good (decided: Q11).
 *
 * Admins pay nothing, open nothing and hold nothing; their analyses still
 * feed the saved analyses. A team member spends the owner's credit; the
 * report is the member's and, like every team report, readable by the team,
 * which therefore buys each deal's analysis once.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { createSupabaseServerClient } from '../supabase/server';
import { payerFor } from '../team';
import { getBillingSettings } from '../credit/unit-costs';
import { openCreditBase } from '../credit/deal-pricing';
import { quoterFor } from '../credit/quote-server';
import { debit, getBalance, release, reserve, InsufficientCreditError } from '../credit/ledger';
import { isEnforcing } from '../credit/http';
import { afterDebit } from '../credit/after-debit';
import { startAction, SeatPausedError } from '../credit/action';
import { runMetered } from '../credit/context';
import { ask, pdMortgageRates } from '../broker';
import { liveMortgageRate } from '../listing/mortgage-rate';
import { postcodeAreaOf } from '../listing/normalise';
import { dealTrackingFor } from '../listing/tracked-server';
import { parseMarketGoals } from '../market/goals';
import { openDeal, existingOpen, dealListingFor } from '../marketplace/open';
import { loadDealById } from '../marketplace/server';
import { openPricePence } from '../marketplace/ladder';
import { dealVisibilityFor } from '../marketplace/tier';
import { dealVisible } from '../marketplace/visibility';
import type { AnalysisResult } from '../types';
import type { AnalysisInput } from './input';
import { enhancedEnabled, fetchSecondOpinion, runAnalysis, type PreparedAnalysis } from './run';
import { noticeForEmptyResult, type EnhancedNotice } from './enhanced-notice';
import { dealAnalysisInput, dealListingPrice } from './deal-input';
import { analysisComplete, rebuildForMember, reusable, sharedInputs, toShared, type SharedAnalysis } from './reuse';
import { logActivity, recordActivity } from '../activity/log';
import { activeProfileIdOf } from '../profiles/server';
import { reminderEvent } from './take-up';
import { reportProjectFor } from '../project/report-server';
import { ANALYSIS_RESERVATION_MINUTES, analysisDescription, analysisMessage, analysisQuote, faceMatches, purchaseStale, quoteMatches, runWindowClosed, type AnalysisErrorCode, type AnalysisQuote } from './deal-analysis-rules';

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Admin = ReturnType<typeof createAdminClient>;

const PURCHASE_COLUMNS = 'id, user_id, buyer_id, kind, status, deal_id, canonical_url, report_id, analysis_id, with_pmi, input_key, inputs, quoted_base_pence, analysis_base_pence, pmi_base_pence, open_credit_base_pence, opened_by_purchase, open_action_id, reservation_id, reused, created_at, ready_at, run_started_at';

export interface PurchaseRow {
  id: string;
  user_id: string;
  buyer_id: string;
  kind: 'full_analysis' | 'pmi_addon';
  status: 'pending' | 'complete' | 'failed';
  deal_id: string | null;
  canonical_url: string | null;
  report_id: string | null;
  analysis_id: string | null;
  with_pmi: boolean;
  input_key: string | null;
  inputs: AnalysisInput | null;
  quoted_base_pence: number | null;
  analysis_base_pence: number;
  pmi_base_pence: number;
  open_credit_base_pence: number;
  opened_by_purchase: boolean;
  open_action_id: string | null;
  reservation_id: string | null;
  reused: boolean | null;
  created_at: string;
  ready_at: string | null;
  run_started_at: string | null;
}

export interface AnalysisFailure {
  ok: false;
  code: AnalysisErrorCode;
  message: string;
  reportId?: string;
  quote?: AnalysisQuote;
  requiredPence?: number;
  availablePence?: number;
}

function fail(code: AnalysisErrorCode, extra: Partial<Omit<AnalysisFailure, 'ok' | 'code'>> & { openedByPurchase?: boolean } = {}): AnalysisFailure {
  const { openedByPurchase, ...rest } = extra;
  return { ok: false, code, message: rest.message ?? analysisMessage(code, { openedByPurchase }), ...rest };
}

function toPurchase(r: Record<string, unknown>): PurchaseRow {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    buyer_id: String(r.buyer_id),
    kind: r.kind === 'pmi_addon' ? 'pmi_addon' : 'full_analysis',
    status: r.status === 'complete' ? 'complete' : r.status === 'failed' ? 'failed' : 'pending',
    deal_id: (r.deal_id as string | null) ?? null,
    canonical_url: (r.canonical_url as string | null) ?? null,
    report_id: (r.report_id as string | null) ?? null,
    analysis_id: (r.analysis_id as string | null) ?? null,
    with_pmi: Boolean(r.with_pmi),
    input_key: (r.input_key as string | null) ?? null,
    inputs: (r.inputs as AnalysisInput | null) ?? null,
    quoted_base_pence: r.quoted_base_pence === null || r.quoted_base_pence === undefined ? null : n(r.quoted_base_pence),
    analysis_base_pence: n(r.analysis_base_pence),
    pmi_base_pence: n(r.pmi_base_pence),
    open_credit_base_pence: n(r.open_credit_base_pence),
    opened_by_purchase: Boolean(r.opened_by_purchase),
    open_action_id: (r.open_action_id as string | null) ?? null,
    reservation_id: (r.reservation_id as string | null) ?? null,
    reused: r.reused === null || r.reused === undefined ? null : Boolean(r.reused),
    created_at: String(r.created_at ?? ''),
    ready_at: (r.ready_at as string | null) ?? null,
    run_started_at: (r.run_started_at as string | null) ?? null,
  };
}


/**
 * Marks a purchase failed (only while pending) and lets its hold go. With
 * `unclaimed`, only while no run has claimed it (the claim's own condition),
 * so a run that got in first is never failed under itself: false then, and
 * the hold stays with the run. Never throws.
 */
async function failPurchase(admin: Admin, row: Pick<PurchaseRow, 'id' | 'reservation_id'>, reason: string, opts: { unclaimed?: boolean } = {}): Promise<boolean> {
  try {
    let q = admin.from('analysis_purchases').update({ status: 'failed', failure: reason.slice(0, 200), completed_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'pending');
    if (opts.unclaimed) q = q.is('run_started_at', null);
    const { data, error } = await q.select('id');
    if (error) {
      console.error('[deal-analysis] mark failed failed:', error.message);
      // Unknown whether a run holds it: its hold stays.
      if (opts.unclaimed) return false;
    } else if (opts.unclaimed && (data ?? []).length === 0) return false;
  } catch (err) {
    console.error('[deal-analysis] mark failed threw:', err);
    if (opts.unclaimed) return false;
  }
  await release(row.reservation_id);
  return true;
}

// ── What the member can already open ──

/**
 * A Full analysis (or a full report from before them) this person can open
 * for the deal: their own first, then the team's. Reads go through the
 * member's own client, so saved_searches' RLS decides what is theirs to see;
 * `candidates` are the pipeline-linked reports dealTrackingFor found.
 */
export async function readableReportFor(supabase: ServerClient, userId: string, dealId: string, candidates: { id: string; userId: string }[]): Promise<{ id: string; userId: string; analysedAt: string | null } | null> {
  const found: { id: string; userId: string; analysedAt: string | null; createdAt: string }[] = [];
  const { data: byDeal, error } = await supabase.from('saved_searches').select('id, user_id, analysed_at, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(10);
  // A missing column (schema.sql not run yet) reads as none.
  if (!error) for (const r of (byDeal ?? []) as { id: string; user_id: string; analysed_at: string | null; created_at: string }[]) found.push({ id: r.id, userId: r.user_id, analysedAt: r.analysed_at, createdAt: r.created_at });
  if (candidates.length > 0) {
    const { data: readable } = await supabase.from('saved_searches').select('id, user_id, created_at').in('id', candidates.map((c) => c.id));
    const ok = new Map(((readable ?? []) as { id: string; user_id: string; created_at: string }[]).map((r) => [r.id, r]));
    for (const c of candidates) {
      const r = ok.get(c.id);
      if (r && !found.some((f) => f.id === r.id)) found.push({ id: r.id, userId: r.user_id, analysedAt: null, createdAt: r.created_at });
    }
  }
  if (found.length === 0) return null;
  const own = found.find((f) => f.userId === userId);
  const pick = own ?? found[0];
  return { id: pick.id, userId: pick.userId, analysedAt: pick.analysedAt };
}

// ── Abandoned purchases ──

/**
 * A pending purchase nobody is working on: settled so the account is not
 * stuck behind it. A report it saved makes it complete (whatever it managed
 * to charge stands; nothing is charged late); otherwise it failed and its
 * hold is released. Returns 'running' while it may still be alive.
 */
async function settleIfAbandoned(admin: Admin, row: PurchaseRow, now: Date): Promise<'running' | { reportId: string | null }> {
  if (!purchaseStale(row, now)) return 'running';
  let reportId: string | null = null;
  if (row.kind === 'full_analysis' && row.deal_id) {
    const { data } = await admin.from('saved_searches').select('id').eq('user_id', row.buyer_id).eq('deal_id', row.deal_id).gte('created_at', row.created_at).order('created_at', { ascending: false }).limit(1);
    reportId = ((data ?? []) as { id: string }[])[0]?.id ?? null;
  }
  // Settled only as it was read: a run that claimed it since is alive and left alone.
  let q = admin
    .from('analysis_purchases')
    .update(reportId ? { status: 'complete', report_id: reportId, failure: 'settled after the run stopped', completed_at: now.toISOString() } : { status: 'failed', failure: 'abandoned', completed_at: now.toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending');
  q = row.run_started_at ? q.eq('run_started_at', row.run_started_at) : q.is('run_started_at', null);
  const { data: settled, error } = await q.select('id');
  if (error) {
    console.error('[deal-analysis] settle failed:', error.message);
    return 'running';
  }
  if ((settled ?? []).length === 0) return 'running';
  await release(row.reservation_id);
  if (reportId) console.warn(`[deal-analysis] purchase ${row.id} settled as complete after its run stopped`);
  return { reportId };
}

// ── Start ──

export type StartResult = { ok: true; purchaseId: string; openedNow: boolean } | AnalysisFailure;

/**
 * `from`: 'stage' or 'kept_step' when the member came from a reminder's
 * button (the deal page's ?from=), for the reminder_acted event.
 */
export async function startDealAnalysis(input: { supabase: ServerClient; userId: string; adminUser: boolean; dealId: string; withPmi: boolean; quotedBasePence: unknown; quotedFacePence?: unknown; from?: unknown }): Promise<StartResult> {
  if (!hasServiceRole()) return fail('failed');
  const admin = createAdminClient();
  const now = new Date();
  const payer = await payerFor(input.userId);
  if (payer.suspended) return fail('seat_paused');
  const accountId = payer.payerId;
  const deal = await loadDealById(admin, input.dealId);
  if (!deal) return fail('missing');

  // ── Already theirs to read? Never sold twice. ──
  const tracking = await dealTrackingFor({ userId: input.userId, deal });
  const readable = await readableReportFor(input.supabase, input.userId, deal.id, tracking.reportCandidates);
  if (readable) return fail('already_done', { reportId: readable.id });
  const { data: pendingRows, error: pendingErr } = await admin.from('analysis_purchases').select(PURCHASE_COLUMNS).eq('user_id', accountId).eq('deal_id', deal.id).eq('kind', 'full_analysis').eq('status', 'pending').limit(1);
  if (pendingErr) {
    console.error('[deal-analysis] purchases read failed (schema.sql not run?):', pendingErr.message);
    return fail('failed');
  }
  const pending = (pendingRows ?? [])[0] as Record<string, unknown> | undefined;
  if (pending) {
    const row = toPurchase(pending);
    if (row.buyer_id === input.userId && row.ready_at && !row.run_started_at && !runWindowClosed(row, now)) {
      // Their own purchase, started but its run never asked for (the
      // connection dropped between the two requests, or another tab): let it
      // go and start afresh, unless a run claims it first.
      if (!(await failPurchase(admin, row, 'started again', { unclaimed: true }))) return fail('running');
    } else {
      const settled = await settleIfAbandoned(admin, row, now);
      if (settled === 'running') return fail('running');
      // Theirs to open only if they can read it (its buyer may have left the team since).
      if (settled.reportId) {
        const { data: readableRow } = await input.supabase.from('saved_searches').select('id').eq('id', settled.reportId).maybeSingle();
        if (readableRow) return fail('already_done', { reportId: settled.reportId });
      }
    }
  }

  // ── Can it be analysed at all? Checked before anything is charged. ──
  const open = await existingOpen(admin, accountId, deal.canonical_url);
  const isOpen = open?.status === 'open';
  const visibility = isOpen || input.adminUser ? null : await dealVisibilityFor(input.userId, input.adminUser);
  if (visibility) {
    if (!dealVisible(deal.live_since, visibility.cutoffIso)) return fail('missing');
    if (deal.status === 'retired') return fail('gone');
    if (deal.status === 'pending_verify') return fail('checking');
    // On the shortlist for its own check (Batch 16), or its Project check (Batch 17): nothing to analyse yet.
    if (deal.status === 'pending_check') return fail('held');
  }
  const withPmi = Boolean(input.withPmi);
  if (withPmi && !enhancedEnabled(true)) return fail('pmi_unavailable');
  const { listing, snapshot } = await dealListingFor(admin, deal);
  if (!snapshot) return fail('invalid');
  const inputs = dealAnalysisInput(
    { ...snapshot, postcode: listing?.postcode ?? snapshot.postcode, displayAddress: listing?.address ?? snapshot.displayAddress },
    { canonicalUrl: deal.canonical_url, kind: deal.kind, price: dealListingPrice(deal.price_amount, deal.price_period), withPmi, checkedListingId: tracking.checkedListingId },
  );
  if (!inputs.ok) return fail(inputs.code, { message: inputs.message });

  // ── The price, exactly as the button showed it ──
  const settings = await getBillingSettings();
  const pricing = settings.dealPricing;
  const ladderPence = openPricePence(deal.annual_profit === null ? null : Number(deal.annual_profit), settings.dealOpenLadder);
  const quote = analysisQuote({ admin: input.adminUser, pricing, opened: isOpen, openPaidBasePence: isOpen ? openCreditBase(open) : 0, openPricePence: ladderPence, withPmi });
  if (!quoteMatches(input.quotedBasePence, quote.due)) return fail('price_changed', { quote });
  if (!input.adminUser && quote.due.purchaseBasePence > 0 && isEnforcing()) {
    const bal = await getBalance(accountId).catch(() => null);
    const available = bal?.spendableBasePence ?? 0;
    if (available < quote.due.purchaseBasePence) return fail('insufficient_credit', { requiredPence: quote.due.purchaseBasePence, availablePence: Math.max(0, Math.round(available)) });
  }
  // And what they pay from their own credit, as the button showed it: a
  // daily charge or a top-up since the page loaded can move it.
  if (!input.adminUser && quote.due.purchaseBasePence > 0) {
    const walk = (await quoterFor(accountId, false)).quote(quote.due.purchaseBasePence);
    if (walk.shortfallBasePence <= 0 && !faceMatches(input.quotedFacePence, walk.facePence)) return fail('price_changed', { quote });
  }

  // ── Claim: one pending purchase per account and deal ──
  const { data: claimed, error: claimErr } = await admin
    .from('analysis_purchases')
    .insert({
      user_id: accountId,
      buyer_id: input.userId,
      kind: 'full_analysis',
      status: 'pending',
      deal_id: deal.id,
      canonical_url: deal.canonical_url,
      with_pmi: withPmi,
      input_key: inputs.key,
      inputs: inputs.input,
      quoted_base_pence: quote.due.purchaseBasePence,
      analysis_base_pence: quote.due.analysisBasePence,
      pmi_base_pence: quote.due.pmiBasePence,
      open_credit_base_pence: quote.openPaidBasePence,
    })
    .select('id')
    .single();
  if (claimErr?.code === '23505') return fail('running');
  if (claimErr || !claimed?.id) {
    console.error('[deal-analysis] claim failed:', claimErr?.message);
    return fail('failed');
  }
  const purchaseId = String(claimed.id);

  // ── Open it first, when it is not open to the account yet ──
  let openCredit = quote.openPaidBasePence;
  let openedNow = false;
  let openActionId: string | null = null;
  if (!quote.opened && visibility) {
    let outcome;
    try {
      outcome = await openDeal({ userId: accountId, adminUser: false, dealId: deal.id, memberId: payer.memberId, visibility, profileId: payer.memberId ? null : await activeProfileIdOf(accountId) });
    } catch (err) {
      console.error('[deal-analysis] open threw:', err);
      outcome = { ok: false as const, code: 'failed' as const };
    }
    if (!outcome.ok) {
      await failPurchase(admin, { id: purchaseId, reservation_id: null }, `open:${outcome.code}`);
      if (outcome.code === 'insufficient_credit') return fail('insufficient_credit', { requiredPence: outcome.requiredPence, availablePence: outcome.availablePence });
      return fail(outcome.code);
    }
    const row = await existingOpen(admin, accountId, deal.canonical_url);
    openCredit = row ? openCreditBase(row) : Math.max(0, Number(outcome.chargedBasePence) || 0);
    openedNow = !outcome.alreadyOpen;
    openActionId = openedNow ? (row?.id ?? null) : null;
    // The same event (and key) as a Quick look's, so the deal counts as opened once.
    if (openedNow) logActivity(input.userId, 'deal_open', { dealId: deal.id, dedupeKey: `deal_open:${deal.id}`, extras: { via: 'full_analysis' } });
  }
  const due = analysisQuote({ admin: input.adminUser, pricing, opened: true, openPaidBasePence: openCredit, openPricePence: 0, withPmi }).due;

  // ── Hold the rest ──
  let reservationId: string | null = null;
  if (!input.adminUser && due.totalBasePence > 0) {
    try {
      reservationId = await reserve(accountId, 'full_analysis', purchaseId, due.totalBasePence, ANALYSIS_RESERVATION_MINUTES);
    } catch (err) {
      if (err instanceof InsufficientCreditError && isEnforcing()) {
        await failPurchase(admin, { id: purchaseId, reservation_id: null }, 'insufficient_credit');
        return fail('insufficient_credit', { requiredPence: due.totalBasePence, availablePence: Math.max(0, Math.round(err.availablePence)), openedByPurchase: openedNow });
      }
      // Shadow mode (or a hold that failed to write): the run goes ahead unheld, as every metered action does.
      console.warn('[deal-analysis] reservation not held:', (err as Error)?.message ?? err);
    }
  }
  const { error: readyErr } = await admin
    .from('analysis_purchases')
    .update({ analysis_base_pence: due.analysisBasePence, pmi_base_pence: due.pmiBasePence, open_credit_base_pence: openCredit, opened_by_purchase: openedNow, open_action_id: openActionId, reservation_id: reservationId, ready_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .eq('status', 'pending');
  if (readyErr) {
    console.error('[deal-analysis] ready update failed:', readyErr.message);
    await failPurchase(admin, { id: purchaseId, reservation_id: reservationId }, 'ready');
    return fail('failed', { openedByPurchase: openedNow });
  }
  const acted = reminderEvent('acted', { dealId: deal.id, where: input.from, stage: tracking.stage });
  if (acted) logActivity(input.userId, 'reminder_acted', { dealId: deal.id, dedupeKey: acted.dedupeKey, extras: acted.extras });
  return { ok: true, purchaseId, openedNow };
}

// ── Run ──

export type ClaimRunResult = { ok: true; purchase: PurchaseRow } | AnalysisFailure;

/** Takes the run for a started purchase: only its buyer, only once, only in time. */
export async function claimDealAnalysisRun(userId: string, purchaseId: string, dealId: string): Promise<ClaimRunResult> {
  if (!hasServiceRole()) return fail('failed');
  const admin = createAdminClient();
  const now = new Date();
  const { data, error } = await admin.from('analysis_purchases').select(PURCHASE_COLUMNS).eq('id', purchaseId).maybeSingle();
  if (error) {
    console.error('[deal-analysis] purchase read failed:', error.message);
    return fail('failed');
  }
  if (!data) return fail('missing');
  const row = toPurchase(data as Record<string, unknown>);
  // Someone else's purchase reads as no purchase at all.
  if (row.buyer_id !== userId || row.kind !== 'full_analysis' || row.deal_id !== dealId) return fail('missing');
  if (row.status === 'complete') return fail('already_done', row.report_id ? { reportId: row.report_id } : {});
  if (row.status === 'failed') return fail('failed', { openedByPurchase: row.opened_by_purchase });
  if (!row.ready_at) return fail('running');
  if (row.run_started_at) return fail('running');
  if (runWindowClosed(row, now)) {
    await failPurchase(admin, row, 'run never started', { unclaimed: true });
    return fail('expired', { openedByPurchase: row.opened_by_purchase });
  }
  // Still on the account that is paying, and not paused since the start: a
  // reused analysis runs no metered action, so nothing later would check.
  const payer = await payerFor(userId);
  if (payer.suspended || payer.payerId !== row.user_id) {
    await failPurchase(admin, row, payer.suspended ? 'seat paused' : 'no longer on the paying account', { unclaimed: true });
    return fail('seat_paused', { openedByPurchase: row.opened_by_purchase });
  }
  const { data: taken, error: takeErr } = await admin.from('analysis_purchases').update({ run_started_at: now.toISOString() }).eq('id', purchaseId).eq('status', 'pending').is('run_started_at', null).select(PURCHASE_COLUMNS);
  if (takeErr) {
    console.error('[deal-analysis] run claim failed:', takeErr.message);
    return fail('failed');
  }
  const got = (taken ?? [])[0] as Record<string, unknown> | undefined;
  return got ? { ok: true, purchase: toPurchase(got) } : fail('running');
}

export type RunResult = { ok: true; reportId: string; result: AnalysisResult; reused: boolean; chargedBasePence: number } | AnalysisFailure;

interface SavedAnalysis {
  id: string;
  analysedAt: string;
  shared: SharedAnalysis;
}

async function latestSaved(admin: Admin, dealId: string, inputKey: string, reuseDays: number, now: Date): Promise<SavedAnalysis | null> {
  const since = new Date(now.getTime() - reuseDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('deal_analyses').select('id, result, analysed_at').eq('deal_id', dealId).eq('input_key', inputKey).gt('analysed_at', since).order('analysed_at', { ascending: false }).limit(1);
  if (error) {
    console.error('[deal-analysis] saved analysis read failed:', error.message);
    return null;
  }
  const row = ((data ?? []) as { id: string; result: SharedAnalysis | null; analysed_at: string }[])[0];
  if (!row?.result?.result || !reusable(row.analysed_at, reuseDays, now) || !analysisComplete(row.result.result)) return null;
  return { id: row.id, analysedAt: row.analysed_at, shared: row.result };
}

/** Raw provider cost of what ran under this purchase, and PMI's share of it (for the margin, never the price). */
async function rawCostOf(admin: Admin, actionId: string): Promise<{ total: number; pmi: number }> {
  const { data } = await admin.from('provider_calls').select('provider, cost_pence').eq('action_id', actionId);
  let total = 0;
  let pmi = 0;
  for (const r of (data ?? []) as { provider: string | null; cost_pence: number | null }[]) {
    const c = Number(r.cost_pence) || 0;
    total += c;
    if (r.provider === 'pmi') pmi += c;
  }
  return { total, pmi };
}

export async function runDealAnalysis(purchase: PurchaseRow, opts: { adminUser: boolean; onProgress?: (e: { stage: string; progress: number; message: string }) => void }): Promise<RunResult> {
  const admin = createAdminClient();
  const progress = (stage: string, pct: number, message: string) => opts.onProgress?.({ stage, progress: pct, message });
  const failed = async (code: AnalysisErrorCode, reason: string): Promise<AnalysisFailure> => {
    await failPurchase(admin, purchase, reason);
    return fail(code, { openedByPurchase: purchase.opened_by_purchase });
  };
  const input = purchase.inputs;
  if (!input || !purchase.deal_id || !purchase.input_key) return failed('failed', 'no inputs');
  const deal = await loadDealById(admin, purchase.deal_id);
  if (!deal) return failed('failed', 'deal missing');

  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const [settings, profileRes] = await Promise.all([getBillingSettings(), admin.from('profiles').select('market_goals').eq('id', purchase.buyer_id).maybeSingle()]);
    const pricing = settings.dealPricing;
    // The BUYER's finance: a saved analysis is priced for whoever buys it.
    const finance = parseMarketGoals(profileRes.data?.market_goals)?.finance;
    const pmiWanted = purchase.with_pmi && enhancedEnabled(true);

    let result: AnalysisResult;
    let reused = false;
    let analysisId: string | null = null;
    let analysedAt = nowIso;
    let rawCost = { total: 0, pmi: 0 };
    const saved = await latestSaved(admin, purchase.deal_id, purchase.input_key, pricing.analysisReuseDays, now);
    if (saved) {
      reused = true;
      analysisId = saved.id;
      analysedAt = saved.analysedAt;
      progress('reuse', 30, 'Using this property’s saved analysis...');
      let shared = saved.shared;
      let pmiNotice: EnhancedNotice | null = null;
      if (pmiWanted && !shared.result.secondOpinion) {
        progress('second_opinion', 50, 'Asking PMI for a second opinion...');
        const action = await startAction({ userId: purchase.buyer_id, admin: opts.adminUser, action: 'full_analysis', actionId: purchase.id, fixedPrice: true });
        try {
          const outcome = await runMetered(action.ctx, () =>
            fetchSecondOpinion({ postcode: input.property.postcode, bedrooms: input.property.bedrooms, bathrooms: input.bathrooms, propertyType: input.propertyType }, { mode: 'full', userId: purchase.buyer_id }),
          );
          if (outcome.value) {
            shared = { ...shared, result: { ...shared.result, secondOpinion: outcome.value } };
            const { error } = await admin.from('deal_analyses').update({ result: shared, has_second_opinion: true, second_opinion_at: nowIso }).eq('id', saved.id).eq('has_second_opinion', false);
            if (error) console.error('[deal-analysis] saved analysis PMI update failed:', error.message);
          } else {
            pmiNotice = outcome.notice;
          }
        } finally {
          await action.finish();
        }
      }
      progress('analysis', 80, 'Working out the figures at your finance...');
      const rates = await ask(pdMortgageRates, {}, { mode: 'full', userId: purchase.buyer_id, cacheOnly: true });
      // Without PMI ticked, a saved opinion is left out (it stays on offer,
      // at the add-on price, from the report).
      result = rebuildForMember(shared, { finance, liveRate: liveMortgageRate(rates.value), askingPrice: input.askingPrice, rentPcm: input.rentPcm, now: nowIso, withSecondOpinion: pmiWanted });
      if (pmiWanted && !result.secondOpinion) result.enhancedNotice = pmiNotice ?? noticeForEmptyResult();
      rawCost = await rawCostOf(admin, purchase.id);
    } else {
      const action = await startAction({ userId: purchase.buyer_id, admin: opts.adminUser, action: 'full_analysis', actionId: purchase.id, fixedPrice: true });
      const prepared: PreparedAnalysis = { ctx: action.ctx, finish: action.finish, reportKind: pmiWanted ? 'report_enhanced' : 'report', maxBasePence: 0 };
      const run = await runAnalysis(prepared, { ...input, enhancedRequested: pmiWanted }, { billedUserId: purchase.buyer_id, admin: opts.adminUser, finance, onProgress: opts.onProgress });
      result = run.result;
      if (!analysisComplete(result)) return failed('incomplete', 'no short-let figures');
      rawCost = await rawCostOf(admin, purchase.id);
      const shared = toShared(result);
      const { data: stored, error: storeErr } = await admin
        .from('deal_analyses')
        .insert({ deal_id: purchase.deal_id, canonical_url: purchase.canonical_url ?? deal.canonical_url, input_key: purchase.input_key, inputs: sharedInputs(input), result: shared, has_second_opinion: Boolean(result.secondOpinion), raw_cost_pence: rawCost.total, action_id: purchase.id, analysed_at: nowIso, second_opinion_at: result.secondOpinion ? nowIso : null })
        .select('id')
        .single();
      // Not being able to keep it for the next member never costs this one their report.
      if (storeErr) console.error('[deal-analysis] saved analysis write failed:', storeErr.message);
      else analysisId = String(stored.id);
    }

    // Batch 17: a Project deal's report carries our estimate (its reasons, never its photos). The member's
    // own locked figures are read with the report, for whoever reads it, and never stored on it.
    const project = await reportProjectFor(admin, deal, { grossRevenue: result.shortLet?.annualRevenue ?? null }, finance);
    if (project) result.project = project;

    // ── The buyer's own report ──
    progress('saving', 95, 'Saving your Full analysis...');
    const { data: savedRow, error: saveErr } = await admin
      .from('saved_searches')
      .insert({
        user_id: purchase.buyer_id,
        name: result.property.address,
        address: result.property.address,
        postcode: result.property.postcode,
        postcode_area: postcodeAreaOf(result.property.postcode),
        guest_count: result.property.guests,
        bedrooms: result.property.bedrooms,
        kind: input.sourceListing?.kind ?? (input.rentPcm ? 'rent' : 'sale'),
        result,
        source_listing: input.sourceListing,
        deal: result.deal,
        checked_listing_id: input.checkedListingId,
        deal_id: purchase.deal_id,
        analysed_at: analysedAt,
      })
      .select('id')
      .single();
    if (saveErr || !savedRow?.id) {
      console.error('[deal-analysis] report save failed:', saveErr?.message);
      return failed('failed', 'report save');
    }
    const reportId = String(savedRow.id);
    result.reportId = reportId;
    if (input.checkedListingId) {
      const { error } = await admin.from('checked_listings').update({ analysed_report_id: reportId, updated_at: nowIso }).eq('id', input.checkedListingId).eq('user_id', purchase.buyer_id);
      if (error) console.error('[deal-analysis] pipeline link failed:', error.message);
    }

    // ── Charge: complete and saved, so now, and only now ──
    const txIds: number[] = [];
    let charged = 0;
    const memberId = purchase.buyer_id !== purchase.user_id ? purchase.buyer_id : null;
    // Batch 13: the Usage split names the profile the member was on (their own spend only).
    const profileId = memberId || opts.adminUser ? null : await activeProfileIdOf(purchase.user_id);
    const charge = async (basePence: number, meta: Record<string, unknown>) => {
      if (opts.adminUser || basePence <= 0) return;
      try {
        const tx = await debit(purchase.user_id, basePence, { reservationId: purchase.reservation_id, allowNegative: true, meta: { action_id: purchase.id, quantity: 1, unit_cost_pence: 0, markup: 1, deal_id: purchase.deal_id, ...(memberId ? { member_id: memberId } : {}), ...(profileId ? { profile_id: profileId } : {}), ...meta } });
        if (tx !== null) txIds.push(tx);
        charged += basePence;
      } catch (err) {
        // The report is theirs either way; an uncharged one is logged loudly, never retried into a double charge.
        console.error(`[deal-analysis] debit failed for purchase ${purchase.id}:`, err);
      }
    };
    await charge(purchase.analysis_base_pence, {
      action: 'full_analysis',
      provider: 'marketplace',
      unit: 'full_analysis',
      raw_cost_pence: Math.round((rawCost.total - rawCost.pmi) * 10000) / 10000,
      description: analysisDescription(deal, reused),
      reused,
      open_credit_base_pence: purchase.open_credit_base_pence,
      ...(purchase.open_action_id ? { open_action_id: purchase.open_action_id } : {}),
    });
    const pmiDelivered = pmiWanted && Boolean(result.secondOpinion);
    if (pmiDelivered) await charge(purchase.pmi_base_pence, { action: 'pmi_addon', provider: 'pmi', unit: 'pmi_addon', raw_cost_pence: rawCost.pmi, description: 'Second opinion from PMI' });
    await release(purchase.reservation_id);
    if (txIds.length > 0) void afterDebit(purchase.user_id).catch(() => {});

    const [{ error: doneErr }] = await Promise.all([
      admin
        .from('analysis_purchases')
        .update({ status: 'complete', report_id: reportId, analysis_id: analysisId, reused, second_opinion: Boolean(result.secondOpinion), transaction_ids: txIds, charged_base_pence: charged, completed_at: new Date().toISOString() })
        .eq('id', purchase.id),
      // This runs after the response (the run route's after()), so it is awaited here.
      recordActivity(purchase.buyer_id, 'full_analysis', {
        dealId: purchase.deal_id,
        dedupeKey: `full_analysis:${purchase.id}`,
        extras: { via: purchase.opened_by_purchase ? 'one_tap' : 'upgrade', reused, pmi_ticked: purchase.with_pmi, pmi: pmiDelivered },
      }),
    ]);
    if (doneErr) console.error('[deal-analysis] complete update failed:', doneErr.message);
    return { ok: true, reportId, result, reused, chargedBasePence: charged };
  } catch (err) {
    console.error('[deal-analysis] run failed:', err);
    return failed(err instanceof SeatPausedError ? 'seat_paused' : err instanceof InsufficientCreditError ? 'insufficient_credit' : 'failed', (err as Error)?.message ?? 'threw');
  }
}
