import { adminClient, hasServiceRole } from './db.ts';
import type { Buckets, SpendRates } from './pricing.ts';
import { round4 } from './pricing.ts';
import { getBillingSettings } from './unit-costs.ts';

/**
 * Thin wrappers over the credit_* Postgres functions (service role). Every
 * mutation is atomic inside the database; this layer only maps errors and
 * shapes results. Without a service role (local dev without Supabase, unit
 * tests) reads return an empty balance and writes are no-ops, so the app
 * still runs — just without billing.
 */

export class InsufficientCreditError extends Error {
  readonly code = 'insufficient_credit';
  readonly requiredPence: number;
  readonly availablePence: number;
  constructor(requiredPence: number, availablePence: number) {
    super('insufficient_credit');
    this.requiredPence = requiredPence;
    this.availablePence = availablePence;
  }
}

export type GrantKind = 'plan' | 'welcome' | 'topup' | 'adjustment';

export interface Balance {
  buckets: Buckets;
  /** Grant pence across every unexpired bucket (what the member sees). */
  totalPence: number;
  /** Base pence the buckets cover after open reservations. */
  spendableBasePence: number;
  reservedBasePence: number;
  planExpiresAt: string | null;
  rates: SpendRates;
}

export const EMPTY_BALANCE: Balance = {
  buckets: { planPence: 0, welcomePence: 0, topupPence: 0, adjustmentPence: 0 },
  totalPence: 0,
  spendableBasePence: 0,
  reservedBasePence: 0,
  planExpiresAt: null,
  rates: { plan: 1, welcome: 1, topup: 1.5, adjustment: 1.5 },
};

interface RpcError {
  code?: string;
  message?: string;
  details?: string | null;
}

function toInsufficient(err: RpcError): InsufficientCreditError | null {
  if (err.code !== 'P0402' && err.message !== 'insufficient_credit') return null;
  let required = 0;
  let available = 0;
  try {
    const d = JSON.parse(err.details ?? '{}') as Record<string, unknown>;
    required = Number(d.required_base ?? 0) || 0;
    available = Number(d.spendable_base ?? (Number(d.required_base ?? 0) - Number(d.shortfall_base ?? 0))) || 0;
  } catch {
    /* no detail */
  }
  return new InsufficientCreditError(required, available);
}

function throwRpc(err: RpcError, what: string): never {
  const ins = toInsufficient(err);
  if (ins) throw ins;
  throw new Error(`[credit] ${what} failed: ${err.message ?? 'unknown error'}`);
}

export async function getBalance(userId: string): Promise<Balance> {
  if (!hasServiceRole()) return EMPTY_BALANCE;
  const [{ data, error }, settings] = await Promise.all([(await adminClient()).rpc('credit_available', { p_user: userId }), getBillingSettings()]);
  if (error) throwRpc(error, 'credit_available');
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  const n = (k: string) => round4(Number(row?.[k] ?? 0) || 0);
  const buckets: Buckets = { planPence: n('plan_pence'), welcomePence: n('welcome_pence'), topupPence: n('topup_pence'), adjustmentPence: n('adjustment_pence') };
  return {
    buckets,
    totalPence: round4(buckets.planPence + buckets.welcomePence + buckets.topupPence + buckets.adjustmentPence),
    spendableBasePence: n('spendable_base_pence'),
    reservedBasePence: n('reserved_base_pence'),
    planExpiresAt: (row?.plan_expires_at as string | null) ?? null,
    rates: settings.spendRates,
  };
}

export async function reserve(userId: string, action: string, actionId: string, maxBasePence: number, ttlMinutes = 10): Promise<string | null> {
  if (!hasServiceRole()) return null;
  if (maxBasePence <= 0) return null;
  const { data, error } = await (await adminClient()).rpc('credit_reserve', { p_user: userId, p_action: action, p_action_id: actionId, p_max_base: round4(maxBasePence), p_ttl: `${ttlMinutes} minutes` });
  if (error) throwRpc(error, 'credit_reserve');
  return (data as string | null) ?? null;
}

export async function release(reservationId: string | null | undefined): Promise<void> {
  if (!reservationId || !hasServiceRole()) return;
  const { error } = await (await adminClient()).rpc('credit_release', { p_reservation: reservationId });
  if (error) console.error('[credit] credit_release failed:', error.message);
}

export interface DebitMeta {
  action_id?: string | null;
  action?: string | null;
  provider?: string;
  unit?: string;
  quantity?: number;
  unit_cost_pence?: number;
  markup?: number;
  raw_cost_pence?: number;
  description?: string;
  provider_call_id?: number | null;
  [k: string]: unknown;
}

export async function debit(userId: string, basePence: number, opts: { reservationId?: string | null; allowNegative?: boolean; meta?: DebitMeta } = {}): Promise<number | null> {
  if (!hasServiceRole() || basePence <= 0) return null;
  const { data, error } = await (await adminClient()).rpc('credit_debit', {
    p_user: userId,
    p_base_pence: round4(basePence),
    p_reservation: opts.reservationId ?? null,
    p_allow_negative: opts.allowNegative ?? false,
    p_meta: opts.meta ?? {},
  });
  if (error) throwRpc(error, 'credit_debit');
  return (data as number | null) ?? null;
}

export async function refund(transactionId: number, basePence?: number, reason?: string): Promise<number | null> {
  if (!hasServiceRole()) return null;
  const { data, error } = await (await adminClient()).rpc('credit_refund', { p_transaction_id: transactionId, p_base_pence: basePence ?? null, p_reason: reason ?? null });
  if (error) throwRpc(error, 'credit_refund');
  return (data as number | null) ?? null;
}

export async function grant(userId: string, kind: GrantKind, amountPence: number, opts: { expiresAt?: string | Date | null; sourceRef?: string | null; description?: string | null } = {}): Promise<string | null> {
  if (!hasServiceRole()) return null;
  const expires = opts.expiresAt instanceof Date ? opts.expiresAt.toISOString() : (opts.expiresAt ?? null);
  const { data, error } = await (await adminClient()).rpc('credit_grant', {
    p_user: userId,
    p_kind: kind,
    p_amount: round4(amountPence),
    p_expires_at: expires,
    p_source_ref: opts.sourceRef ?? null,
    p_description: opts.description ?? null,
  });
  if (error) throwRpc(error, 'credit_grant');
  return (data as string | null) ?? null;
}

export async function expirePlanGrants(userId: string, reason: string): Promise<number> {
  if (!hasServiceRole()) return 0;
  const { data, error } = await (await adminClient()).rpc('credit_expire_plan_grants', { p_user: userId, p_reason: reason });
  if (error) throwRpc(error, 'credit_expire_plan_grants');
  return Number(data ?? 0) || 0;
}

export async function expireDueGrants(): Promise<number> {
  if (!hasServiceRole()) return 0;
  const { data, error } = await (await adminClient()).rpc('credit_expire_due');
  if (error) throwRpc(error, 'credit_expire_due');
  return Number(data ?? 0) || 0;
}

export class CodeError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export async function redeemCode(userId: string, code: string): Promise<{ kind: string; amountPence: number }> {
  if (!hasServiceRole()) throw new CodeError('not_configured');
  const { data, error } = await (await adminClient()).rpc('credit_redeem_code', { p_user: userId, p_code: code });
  if (error) {
    if (error.code === 'P0403') throw new CodeError(error.message || 'code_invalid');
    throwRpc(error, 'credit_redeem_code');
  }
  const d = (data ?? {}) as { kind?: string; amount_pence?: number };
  return { kind: d.kind ?? 'promo', amountPence: Number(d.amount_pence ?? 0) || 0 };
}

/** True when a debit for this action id already exists (once-per-action charges). */
export async function actionAlreadyCharged(actionId: string): Promise<boolean> {
  if (!hasServiceRole()) return false;
  const { data } = await (await adminClient()).from('credit_transactions').select('id').eq('action_id', actionId).eq('kind', 'debit').limit(1);
  return (data?.length ?? 0) > 0;
}
