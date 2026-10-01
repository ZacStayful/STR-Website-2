import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { newActionId, type MeterContext } from './context';
import { InsufficientCreditError, refund, release, reserve } from './ledger';
import { isEnforcing, shadowModeAllows } from './http';
import { round4 } from './pricing';
import { payerFor } from '../team';

/**
 * A team member whose seat is paused may not spend the team's credit. An
 * InsufficientCreditError, so every door that already turns "out of
 * credit" into a 402 or a message does the same here.
 */
export class SeatPausedError extends InsufficientCreditError {
  constructor(requiredPence: number) {
    super(requiredPence, 0);
    this.message = 'seat_paused';
  }
}

/**
 * Brackets a user action (a report, a quick view, a narration) for billing:
 * reserves its worst-case cost so it can never run partially unpaid, hands
 * back the meter context to run it under, and releases the hold afterwards.
 * In shadow mode a failed reservation is logged and the action still runs —
 * unless the caller passes `requireCredit`, which public endpoints do,
 * because there an unaffordable run spends our money and not a member's.
 */
export interface StartedAction {
  ctx: MeterContext;
  finish: () => Promise<void>;
}

export async function startAction(opts: { userId: string | null; admin?: boolean; action: string; maxBasePence?: number; oncePerAction?: boolean; actionId?: string; markupOverride?: number; requireCredit?: boolean; funnelId?: string | null; fixedPrice?: boolean }): Promise<StartedAction> {
  const actionId = opts.actionId ?? newActionId();
  // Team members spend their owner's credit. Resolved once, here, so every
  // metered door — the analyser, the API, MCP, quick views, narration —
  // charges the right account without knowing teams exist.
  let payerId = opts.userId;
  let memberId: string | null = null;
  if (opts.userId && !opts.admin) {
    const payer = await payerFor(opts.userId);
    if (payer.suspended) throw new SeatPausedError(opts.maxBasePence ?? 0);
    payerId = payer.payerId;
    memberId = payer.memberId;
  }
  // Batch 21 (B2): shadow mode is for the members who were given the welcome
  // credit. A payer who was not (a pack-era account, pack bought or not; an
  // account whose welcome credit was withheld) is treated as a requireCredit
  // caller: the reservation and every known-cost call must be affordable, so
  // the account can never run up an overdraft for its next grant to repay.
  // One indexed read, and only in shadow mode.
  const welcomed = payerId && !opts.admin && !opts.requireCredit && !isEnforcing() ? await welcomeGranted(payerId) : true;
  const requireCredit = Boolean(opts.requireCredit) || !welcomed;
  const ctx: MeterContext = { userId: payerId, admin: Boolean(opts.admin), action: opts.action, actionId, oncePerAction: opts.oncePerAction, markupOverride: opts.markupOverride, requireCredit, funnelId: opts.funnelId ?? null, memberId, ...(opts.fixedPrice ? { fixedPrice: true } : {}) };
  let reservationId: string | null = null;
  if (payerId && !opts.admin && (opts.maxBasePence ?? 0) > 0) {
    try {
      reservationId = await reserve(payerId, opts.action, actionId, opts.maxBasePence!);
    } catch (err) {
      if (err instanceof InsufficientCreditError) {
        // requireCredit callers (and payers never welcomed) opt out of shadow mode: see MeterContext.
        if (!shadowModeAllows({ requireCredit: opts.requireCredit, welcomeGranted: welcomed })) throw err;
        console.warn(`[credit] shadow mode: ${opts.action} would be blocked (need ${err.requiredPence}, have ${err.availablePence})`);
      } else {
        console.error('[credit] reservation failed, continuing unreserved:', err);
      }
    }
  }
  if (reservationId) ctx.reservationId = reservationId;
  return {
    ctx,
    finish: async () => {
      await release(reservationId);
    },
  };
}

/**
 * Batch 21 (B2): whether this account was given the welcome credit: the
 * `welcome:<user>` grant, which every pre-pack member has (backfilled) and
 * no pack-era account or withheld account ever gets (the pack's bonus is
 * keyed on its payment). A read failure counts as yes, so a database blip
 * never blocks what shadow mode would allow.
 */
export async function welcomeGranted(userId: string): Promise<boolean> {
  if (!hasServiceRole()) return true;
  const { data, error } = await createAdminClient().from('credit_grants').select('id').eq('user_id', userId).eq('source_ref', `welcome:${userId}`).limit(1);
  if (error) {
    console.warn('[credit] welcome grant read failed; treating the account as welcomed:', error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/** Base pence debited so far under one action id, less anything refunded (for "this report used £X"). */
export async function actionSpend(actionId: string): Promise<{ basePence: number; chargedPence: number }> {
  if (!hasServiceRole()) return { basePence: 0, chargedPence: 0 };
  const { data } = await createAdminClient().from('credit_transactions').select('kind, base_pence, amount_pence').eq('action_id', actionId).in('kind', ['debit', 'refund']);
  let base = 0;
  let charged = 0;
  for (const r of data ?? []) {
    const sign = r.kind === 'refund' ? -1 : 1;
    base += sign * (Number(r.base_pence ?? 0) || 0);
    charged += sign * Math.abs(Number(r.amount_pence ?? 0) || 0);
  }
  return { basePence: round4(Math.max(0, base)), chargedPence: round4(Math.max(0, charged)) };
}

/**
 * Refunds what an action was charged when it did not deliver: a report that
 * failed, or the part of one that did not run (`only`: one provider and
 * unit, e.g. PMI's second opinion when it came back empty). Debits already
 * refunded are skipped, so a retry never refunds twice. Never throws; returns
 * the base pence refunded.
 */
export async function refundAction(actionId: string, reason: string, only?: { provider: string; unit: string }): Promise<number> {
  if (!hasServiceRole()) return 0;
  try {
    const admin = createAdminClient();
    let q = admin.from('credit_transactions').select('id, base_pence').eq('action_id', actionId).eq('kind', 'debit');
    if (only) q = q.eq('provider', only.provider).eq('unit', only.unit);
    const [{ data: debits }, { data: refunds }] = await Promise.all([q, admin.from('credit_transactions').select('metadata').eq('action_id', actionId).eq('kind', 'refund')]);
    const done = new Set(((refunds ?? []) as { metadata: { refund_of?: unknown } | null }[]).map((r) => String(r.metadata?.refund_of ?? '')));
    let back = 0;
    for (const d of (debits ?? []) as { id: number; base_pence: number }[]) {
      if (done.has(String(d.id))) continue;
      try {
        await refund(d.id, undefined, reason);
        back += Number(d.base_pence) || 0;
      } catch (err) {
        console.error(`[credit] refund of debit ${d.id} failed:`, (err as Error)?.message ?? err);
      }
    }
    return round4(back);
  } catch (err) {
    console.error('[credit] refundAction failed:', (err as Error)?.message ?? err);
    return 0;
  }
}
