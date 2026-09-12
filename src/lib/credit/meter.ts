import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { currentMeter, type MeterContext } from './context';
import { priceFor, round4 } from './pricing';
import { getUnitCostTable } from './unit-costs';
import { actionAlreadyCharged, debit, getBalance, InsufficientCreditError } from './ledger';
import { isEnforcing } from './http';

/**
 * The single entry point every paid provider call goes through.
 *
 *   const data = await meter({ provider: 'google', unit: 'geocode' }, () => fetch(...))
 *
 * Reads who is paying from the AsyncLocalStorage context (`runMetered`), prices
 * the call from the live unit-cost table, preflights the balance when the
 * quantity is known up front and no reservation is open, runs the call,
 * then debits the actual amount and logs one `provider_calls` row. Cache hits
 * and failures are logged and never charged. Admins and house calls are
 * logged with charged_pence = 0.
 */

export interface MeterCharge<T> {
  provider: string;
  unit: string;
  /** Units used, when known before the call (default 1). */
  quantity?: number;
  /** Units used, read off the result (tokens, characters). Overrides `quantity`. */
  quantityFrom?: (result: T) => number;
  /** Result came from a cache: log it, charge nothing. */
  cacheHit?: (result: T) => boolean;
  /** Result means the provider did not deliver (treated like a throw for billing). */
  failed?: (result: T) => boolean;
  description?: string;
  /** Broker bookkeeping: question name and cache key. */
  question?: string;
  key?: string;
  /** Skip the preflight check (the caller already reserved or checked). */
  skipPreflight?: boolean;
}

const warnedMissing = new Set<string>();

interface CallLog {
  provider: string;
  unit: string;
  question: string;
  key: string | null;
  quantity: number;
  rawPence: number;
  basePence: number;
  chargedPence: number;
  cacheHit: boolean;
  ok: boolean;
  ms: number;
  billedUserId: string | null;
  actionId: string | null;
  bypass: boolean;
}

async function logCall(c: CallLog): Promise<number | null> {
  if (!hasServiceRole()) return null;
  try {
    const { data, error } = await createAdminClient()
      .from('provider_calls')
      .insert({
        provider: c.provider,
        question: c.question,
        key: c.key,
        cost_pence: Math.round(c.rawPence),
        cache_hit: c.cacheHit,
        user_id: c.billedUserId,
        ok: c.ok,
        ms: c.ms,
        unit: c.unit,
        quantity: c.quantity,
        base_pence: c.basePence,
        charged_pence: c.chargedPence,
        billed_user_id: c.billedUserId,
        action_id: c.actionId,
        bypass: c.bypass,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data?.id as number | undefined) ?? null;
  } catch (err) {
    console.error('[credit] provider_calls insert failed:', err);
    return null;
  }
}

export async function meter<T>(charge: MeterCharge<T>, run: () => Promise<T>, ctx: MeterContext | undefined = currentMeter()): Promise<T> {
  const table = await getUnitCostTable();
  const known = charge.quantityFrom ? null : (charge.quantity ?? 1);
  const question = charge.question ?? `${charge.provider}.${charge.unit}`;
  const key = charge.key ?? null;

  if (!table.has(`${charge.provider}:${charge.unit}`) && !warnedMissing.has(`${charge.provider}:${charge.unit}`)) {
    warnedMissing.add(`${charge.provider}:${charge.unit}`);
    console.warn(`[credit] no unit cost for ${charge.provider}:${charge.unit} — charging 0 until a row exists`);
  }

  const billable = Boolean(ctx?.userId) && !ctx?.admin;
  const userId = ctx?.userId ?? null;

  // Preflight: a call with a known cost and no reservation must be affordable.
  if (billable && known !== null && !ctx?.reservationId && !charge.skipPreflight && isEnforcing()) {
    const { basePence } = priceFor(table, charge.provider, charge.unit, known);
    if (basePence > 0) {
      const bal = await getBalance(userId!);
      if (bal.spendableBasePence < basePence) throw new InsufficientCreditError(basePence, bal.spendableBasePence);
    }
  }

  const started = Date.now();
  let result: T;
  try {
    result = await run();
  } catch (err) {
    void logCall({ provider: charge.provider, unit: charge.unit, question, key, quantity: known ?? 0, rawPence: 0, basePence: 0, chargedPence: 0, cacheHit: false, ok: false, ms: Date.now() - started, billedUserId: userId, actionId: ctx?.actionId ?? null, bypass: Boolean(ctx?.admin) });
    throw err;
  }
  const ms = Date.now() - started;

  if (charge.failed?.(result)) {
    void logCall({ provider: charge.provider, unit: charge.unit, question, key, quantity: known ?? 0, rawPence: 0, basePence: 0, chargedPence: 0, cacheHit: false, ok: false, ms, billedUserId: userId, actionId: ctx?.actionId ?? null, bypass: Boolean(ctx?.admin) });
    return result;
  }
  if (charge.cacheHit?.(result)) {
    void logCall({ provider: charge.provider, unit: charge.unit, question, key, quantity: 0, rawPence: 0, basePence: 0, chargedPence: 0, cacheHit: true, ok: true, ms, billedUserId: userId, actionId: ctx?.actionId ?? null, bypass: Boolean(ctx?.admin) });
    return result;
  }

  const quantity = charge.quantityFrom ? charge.quantityFrom(result) : (known ?? 1);
  const price = priceFor(table, charge.provider, charge.unit, quantity);

  // Once-per-action charges (autocomplete sessions): later calls log at £0.
  let alreadyCharged = false;
  if (ctx?.oncePerAction && ctx.actionId && price.basePence > 0) alreadyCharged = await actionAlreadyCharged(ctx.actionId);

  const callId = await logCall({
    provider: charge.provider, unit: charge.unit, question, key, quantity,
    rawPence: price.rawPence, basePence: price.basePence,
    chargedPence: 0, cacheHit: false, ok: true, ms,
    billedUserId: userId, actionId: ctx?.actionId ?? null, bypass: Boolean(ctx?.admin),
  });

  if (billable && price.basePence > 0 && !alreadyCharged) {
    try {
      const txId = await debit(userId!, price.basePence, {
        reservationId: ctx?.reservationId ?? null,
        // The provider has already been paid: never fail the call here. The
        // preflight / reservation is what stops unaffordable calls up front.
        allowNegative: true,
        meta: {
          action_id: ctx?.actionId ?? null,
          action: ctx?.action ?? null,
          provider: charge.provider,
          unit: charge.unit,
          quantity,
          unit_cost_pence: price.unitCostPence,
          markup: price.markup,
          raw_cost_pence: price.rawPence,
          description: charge.description ?? table.get(`${charge.provider}:${charge.unit}`)?.label ?? `${charge.provider} ${charge.unit}`,
          provider_call_id: callId,
        },
      });
      if (callId !== null && txId !== null) {
        const admin = createAdminClient();
        const { data: tx } = await admin.from('credit_transactions').select('amount_pence').eq('id', txId).single();
        const charged = round4(Math.abs(Number(tx?.amount_pence ?? price.basePence)));
        void admin.from('provider_calls').update({ charged_pence: charged }).eq('id', callId).then(({ error }) => {
          if (error) console.error('[credit] provider_calls charged_pence update failed:', error.message);
        });
      }
    } catch (err) {
      console.error('[credit] debit failed after a paid call:', err);
    }
  }

  return result;
}

/** Estimated tokens for a prompt string (~3.5 chars per token, generous). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
