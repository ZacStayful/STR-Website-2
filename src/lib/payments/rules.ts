/**
 * Batch 20, Part E: what a member has paid us, and what their plan is worth
 * a month. The rows live in member_payments and member_refunds; these are
 * the rules that turn Stripe objects into rows and rows into the two figures.
 *
 *   Total paid     every successful payment as charged (VAT included, if any:
 *                  the starter pack, top-ups manual or automatic, subscription
 *                  invoices), less refunds, never below 0. Computed from the
 *                  stored rows rather than kept as a running total: the same
 *                  payment reaches us more than once (Checkout and its
 *                  PaymentIntent, the one-click route and the webhook, a
 *                  redelivery), and a row keyed by the Stripe id can only be
 *                  written once, where a counter would count each copy.
 *   Monthly value  the live plan's price a month (annual ÷ 12), 0 while it
 *                  is paused or when there is no live plan.
 *
 * Pure: no network, no database, no server-only.
 */
import { monthlyPence } from '../billing/churn.ts';

export type PaymentKind = 'starter_pack' | 'topup' | 'auto_topup' | 'subscription';

export interface PaymentRecord {
  /** 'pi:<payment intent>' or 'inv:<invoice>': the row's key, so a second copy changes nothing. */
  id: string;
  userId: string;
  kind: PaymentKind;
  /** As charged, VAT included. */
  amountPence: number;
  currency: string;
  planCode: string | null;
  paymentIntentId: string | null;
}

export interface RefundRecord {
  chargeId: string;
  userId: string;
  paymentIntentId: string | null;
  /** The charge's cumulative amount refunded (Stripe's amount_refunded), never an increment. */
  amountRefundedPence: number;
}

/** What a PaymentIntent's metadata says it paid for, or null when it is not one of ours. */
export function paymentKindFor(metadata: { kind?: string | null; auto?: string | null } | null | undefined): Exclude<PaymentKind, 'subscription'> | null {
  if (metadata?.kind === 'starter_pack') return 'starter_pack';
  if (metadata?.kind === 'topup') return metadata.auto === '1' ? 'auto_topup' : 'topup';
  return null;
}

/** A succeeded PaymentIntent for a pack or a top-up, as a row. */
export function paymentFromIntent(
  pi: { id: string; amount_received?: number | null; amount?: number | null; currency?: string | null; metadata?: Record<string, string | null | undefined> | null },
  userId: string,
): PaymentRecord | null {
  const kind = paymentKindFor(pi.metadata ?? null);
  if (!kind || !pi.id || !userId) return null;
  const amount = Math.round(Number(pi.amount_received ?? pi.amount ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { id: `pi:${pi.id}`, userId, kind, amountPence: amount, currency: (pi.currency ?? 'gbp').toLowerCase(), planCode: null, paymentIntentId: pi.id };
}

/** A paid subscription invoice (anything charged: a renewal, a first month, a plan change's difference), as a row. */
export function paymentFromInvoice(invoice: { id?: string | null; amount_paid?: number | null; currency?: string | null }, userId: string, planCode: string | null): PaymentRecord | null {
  const amount = Math.round(Number(invoice.amount_paid ?? 0));
  if (!invoice.id || !userId || !Number.isFinite(amount) || amount <= 0) return null;
  return { id: `inv:${invoice.id}`, userId, kind: 'subscription', amountPence: amount, currency: (invoice.currency ?? 'gbp').toLowerCase(), planCode, paymentIntentId: null };
}

export function totalPaidPence(paidPence: number, refundedPence: number): number {
  const paid = Number.isFinite(paidPence) ? paidPence : 0;
  const refunded = Number.isFinite(refundedPence) ? refundedPence : 0;
  return Math.max(0, Math.round(paid - refunded));
}

const LIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * What the member's plan is worth a month: its price (annual ÷ 12) while the
 * subscription is live (trialling, past due and a booked cancellation
 * included, until it ends), 0 while paused or with no live plan. `plan` is
 * the plan row for their plan code, when there is one.
 */
export function monthlyValuePence(input: { status: string | null; paused: boolean; plan: { pricePence: number; interval: 'month' | 'year' } | null }): number {
  if (!input.plan || input.paused) return 0;
  if (!input.status || !LIVE.has(input.status.trim().toLowerCase())) return 0;
  return monthlyPence(input.plan);
}
