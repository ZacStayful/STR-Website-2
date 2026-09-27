import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { newActionId, type MeterContext } from './context';
import { InsufficientCreditError, refund, release, reserve } from './ledger';
import { isEnforcing } from './http';
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
  const ctx: MeterContext = { userId: payerId, admin: Boolean(opts.admin), action: opts.action, actionId, oncePerAction: opts.oncePerAction, markupOverride: opts.markupOverride, requireCredit: opts.requireCredit, funnelId: opts.funnelId ?? null, memberId, ...(opts.fixedPrice ? { fixedPrice: true } : {}) };
  let reservationId: string | null = null;
  if (payerId && !opts.admin && (opts.maxBasePence ?? 0) > 0) {
    try {
      reservationId = await reserve(payerId, opts.action, actionId, opts.maxBasePence!);
    } catch (err) {
      if (err instanceof InsufficientCreditError) {
        // requireCredit callers opt out of shadow mode: see MeterContext.
        if (opts.requireCredit || isEnforcing()) throw err;
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
