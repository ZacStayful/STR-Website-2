import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { newActionId, type MeterContext } from './context';
import { InsufficientCreditError, release, reserve } from './ledger';
import { isEnforcing } from './http';
import { round4 } from './pricing';

/**
 * Brackets a user action (a report, a quick view, a narration) for billing:
 * reserves its worst-case cost so it can never run partially unpaid, hands
 * back the meter context to run it under, and releases the hold afterwards.
 * In shadow mode a failed reservation is logged and the action still runs.
 */
export interface StartedAction {
  ctx: MeterContext;
  finish: () => Promise<void>;
}

export async function startAction(opts: { userId: string | null; admin?: boolean; action: string; maxBasePence?: number; oncePerAction?: boolean; actionId?: string }): Promise<StartedAction> {
  const actionId = opts.actionId ?? newActionId();
  const ctx: MeterContext = { userId: opts.userId, admin: Boolean(opts.admin), action: opts.action, actionId, oncePerAction: opts.oncePerAction };
  let reservationId: string | null = null;
  if (opts.userId && !opts.admin && (opts.maxBasePence ?? 0) > 0) {
    try {
      reservationId = await reserve(opts.userId, opts.action, actionId, opts.maxBasePence!);
    } catch (err) {
      if (err instanceof InsufficientCreditError) {
        if (isEnforcing()) throw err;
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

/** Base pence debited so far under one action id (for "this report used £X"). */
export async function actionSpend(actionId: string): Promise<{ basePence: number; chargedPence: number }> {
  if (!hasServiceRole()) return { basePence: 0, chargedPence: 0 };
  const { data } = await createAdminClient().from('credit_transactions').select('base_pence, amount_pence').eq('action_id', actionId).eq('kind', 'debit');
  let base = 0;
  let charged = 0;
  for (const r of data ?? []) {
    base += Number(r.base_pence ?? 0) || 0;
    charged += Math.abs(Number(r.amount_pence ?? 0) || 0);
  }
  return { basePence: round4(base), chargedPence: round4(charged) };
}
