import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '../supabase/admin';
import { emailKey } from '../supabase/email-key';
import { getStripe } from '../stripe/client';
import { grant, getBalance } from '../credit/ledger';
import { normaliseMobile } from '../credit/abuse';
import { grantTopup } from '../stripe/grants';
import { starterPackReceiptEmail } from '../email/billing';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { CONSENT_VERSION, packClawbackPence } from './rules';

/**
 * Paying for the starter pack (Batch 20, Part A), in three steps:
 *
 *   settle   the card is authorised but not captured (Checkout and the
 *            one-click route both use manual capture). The once-per-person
 *            claim (public.starter_pack_claim: the account, its email, its
 *            number, the card) decides: a first pack is captured, a repeat is
 *            cancelled and never charged.
 *   grant    on the captured payment (payment_intent.succeeded, or the
 *            one-click route straight after capturing): the price as top-up
 *            credit (pi:<id>) and the bonus as welcome-kind credit
 *            (pack_bonus:<id>). Both grants are attempted every time and are
 *            idempotent on their source_ref, so a redelivery repairs a run
 *            that died half-way and never grants twice; the receipt and the
 *            Monday update go once, with the claim's move to "granted".
 *   clawback a refund or a dispute takes back the same share of the credit
 *            as of the payment, cumulatively, so a second partial refund is
 *            taken too.
 */

export type SettleOutcome = 'captured' | 'already' | 'blocked' | 'blocked_charged' | 'failed' | 'ignored';
export type GrantOutcome = 'granted' | 'already' | 'blocked' | 'ignored';

interface PurchaseRow {
  payment_intent_id: string;
  user_id: string | null;
  status: 'reserved' | 'granted' | 'blocked' | 'failed';
  blocked_by: string | null;
  price_pence: number;
  credit_pence: number;
  refunded_pence: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function purchaseRow(piId: string): Promise<PurchaseRow | null> {
  const { data, error } = await createAdminClient().from('starter_pack_purchases').select('payment_intent_id, user_id, status, blocked_by, price_pence, credit_pence, refunded_pence').eq('payment_intent_id', piId).maybeSingle();
  if (error) throw new Error(`starter_pack_purchases read failed: ${error.message}`);
  return (data as PurchaseRow | null) ?? null;
}

function fingerprintOf(pi: Stripe.PaymentIntent): string | null {
  const pm = pi.payment_method;
  if (pm && typeof pm === 'object') return pm.card?.fingerprint ?? null;
  return null;
}

async function withPaymentMethod(pi: Stripe.PaymentIntent): Promise<Stripe.PaymentIntent> {
  if (pi.payment_method && typeof pi.payment_method === 'object') return pi;
  return getStripe().paymentIntents.retrieve(pi.id, { expand: ['payment_method'] });
}

/** The once-per-person claim for this payment: new, or the one a redelivery finds. */
async function claim(pi: Stripe.PaymentIntent): Promise<{ status: PurchaseRow['status']; blockedBy: string | null; replay: boolean }> {
  const md = pi.metadata ?? {};
  const userId = md.user_id;
  const admin = createAdminClient();
  const { data: profile } = await admin.from('profiles').select('email, mobile').eq('id', userId).maybeSingle();
  const p = (profile ?? {}) as { email?: string | null; mobile?: string | null };
  const { data, error } = await admin.rpc('starter_pack_claim', {
    p: {
      pi: pi.id,
      user: userId,
      email_key: p.email ? emailKey(p.email) : null,
      mobile_key: normaliseMobile(p.mobile ?? null),
      card: fingerprintOf(pi),
      price: Math.round(num(md.price_pence)),
      credit: Math.round(num(md.credit_pence)),
      currency: pi.currency ?? 'gbp',
      consent_at: md.consent_at ?? null,
      consent_version: md.consent_version ?? CONSENT_VERSION,
    },
  });
  if (error) throw new Error(`starter_pack_claim failed: ${error.message}`);
  const r = (data ?? {}) as { status?: PurchaseRow['status']; blocked_by?: string | null; replay?: boolean };
  return { status: r.status ?? 'failed', blockedBy: r.blocked_by ?? null, replay: Boolean(r.replay) };
}

async function markFailed(piId: string): Promise<void> {
  await createAdminClient().from('starter_pack_purchases').update({ status: 'failed' }).eq('payment_intent_id', piId).eq('status', 'reserved');
}

/**
 * Decide an authorised pack payment: capture a first pack, cancel a repeat.
 * Safe to call again for the same payment (a redelivery, the route and the
 * webhook both): the claim is found, the capture and the cancel carry
 * idempotency keys, and a payment already captured or cancelled is left as it is.
 */
export async function settleStarterPack(paymentIntentId: string): Promise<SettleOutcome> {
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['payment_method'] });
  if (pi.metadata?.kind !== 'starter_pack' || !pi.metadata.user_id) return 'ignored';
  if (pi.status === 'canceled') {
    await markFailed(pi.id);
    return 'failed';
  }
  const c = await claim(pi);
  if (c.status === 'granted') return 'already';
  if (c.status === 'reserved') {
    if (pi.status === 'succeeded') return 'already';
    if (pi.status !== 'requires_capture') {
      await markFailed(pi.id);
      return 'failed';
    }
    try {
      await stripe.paymentIntents.capture(pi.id, {}, { idempotencyKey: `starter_pack_capture:${pi.id}` });
      return 'captured';
    } catch (err) {
      console.error('[starter-pack] capture failed:', (err as Error)?.message ?? err);
      await markFailed(pi.id);
      return 'failed';
    }
  }
  // Blocked (a repeat) or failed: never charge. A payment already captured
  // (by hand in Stripe, say) is added as a plain top-up when it arrives.
  if (pi.status === 'succeeded') return 'blocked_charged';
  if (pi.status === 'requires_capture') {
    try {
      await stripe.paymentIntents.cancel(pi.id, {}, { idempotencyKey: `starter_pack_cancel:${pi.id}` });
    } catch (err) {
      console.error('[starter-pack] cancel failed:', (err as Error)?.message ?? err);
    }
  }
  return c.status === 'blocked' ? 'blocked' : 'failed';
}

/**
 * Grant a captured pack payment. `pi` must have succeeded. Returns 'granted'
 * the first time (the receipt and the Monday update go then), 'already' after
 * that, and 'blocked' when the payment was a repeat that got charged anyway
 * (it becomes a plain top-up of what was paid for).
 */
export async function grantStarterPack(input: { paymentIntent: Stripe.PaymentIntent; email: string | null }): Promise<GrantOutcome> {
  const pi = input.paymentIntent;
  const md = pi.metadata ?? {};
  if (md.kind !== 'starter_pack' || !md.user_id || pi.status !== 'succeeded') return 'ignored';
  const userId = md.user_id;
  let row = await purchaseRow(pi.id);
  if (!row) {
    // Captured without being settled here (by hand in Stripe): claim it now.
    await claim(await withPaymentMethod(pi));
    row = await purchaseRow(pi.id);
    if (!row) throw new Error(`starter pack ${pi.id}: no claim row after claiming`);
  }
  const admin = createAdminClient();
  const price = Math.round(num(row.price_pence));
  const credit = Math.round(num(row.credit_pence));

  if (row.status === 'blocked' || row.status === 'failed') {
    // A repeat that was charged: the member gets what they paid for, as any top-up.
    if (price > 0) await grantTopup(userId, price, `pi:${pi.id}`, { email: input.email });
    return 'blocked';
  }

  const nowIso = new Date().toISOString();
  const { data: moved, error: moveErr } = await admin
    .from('starter_pack_purchases')
    .update({ status: 'granted', granted_at: nowIso, amount_paid_pence: pi.amount_received ?? pi.amount })
    .eq('payment_intent_id', pi.id)
    .eq('status', 'reserved')
    .select('payment_intent_id');
  if (moveErr) throw new Error(`starter_pack_purchases update failed: ${moveErr.message}`);
  const first = (moved?.length ?? 0) > 0;

  // Both grants every time: idempotent on source_ref, so a redelivery completes a half-done run and never doubles it.
  const bonus = Math.max(0, credit - price);
  if (price > 0) await grant(userId, 'topup', price, { sourceRef: `pi:${pi.id}`, description: 'Starter pack' });
  if (bonus > 0) await grant(userId, 'welcome', bonus, { sourceRef: `pack_bonus:${pi.id}`, description: 'Starter pack bonus credit' });

  // last_topup_at makes them paid for early access (hasEverPaid), as any top-up does.
  const { data: prof } = await admin.from('profiles').select('starter_pack_bought_at').eq('id', userId).maybeSingle();
  const patch: Record<string, unknown> = { last_topup_at: nowIso, hit_zero_at: null };
  if (!(prof as { starter_pack_bought_at?: string | null } | null)?.starter_pack_bought_at) patch.starter_pack_bought_at = nowIso;
  const { error: profErr } = await admin.from('profiles').update(patch).eq('id', userId);
  if (profErr) console.error('[starter-pack] profile update failed:', profErr.message);

  // A team owner's seats paused for want of credit come back now.
  try {
    const { reinstateSeats } = await import('../team/seats');
    await reinstateSeats({ ownerId: userId });
  } catch (err) {
    console.error('[starter-pack] seat reinstatement failed:', (err as Error)?.message ?? err);
  }

  if (first) {
    if (input.email) {
      const bal = await getBalance(userId).catch(() => null);
      await starterPackReceiptEmail(input.email, { pricePence: price, creditPence: credit, balancePence: bal?.totalPence ?? credit }).catch(() => false);
    }
    await queueFunnelSync(userId, 'starter_pack');
  }
  return first ? 'granted' : 'already';
}

/**
 * A pack's payment refunded or disputed: take back the same share of its
 * credit (all of it for a full refund), whatever has been spent; the ledger
 * may go negative until the next credit repays it. Cumulative: the first
 * clawback is `pi:<id>:refunded` (the name Batch 9 and Batch 19 look for), a
 * later partial refund `pi:<id>:refunded:<total refunded>`, each only the
 * difference. The pack stays used.
 */
export async function clawbackStarterPack(input: { userId: string; paymentIntentId: string; refundedPence: number; chargedPence: number; reason: 'refunded' | 'disputed' }): Promise<number> {
  const row = await purchaseRow(input.paymentIntentId);
  const creditBase = row ? (row.status === 'granted' ? num(row.credit_pence) : num(row.price_pence)) : 0;
  if (!row || creditBase <= 0) return 0;
  const target = packClawbackPence({ creditPence: creditBase, chargedPence: input.chargedPence, refundedPence: input.refundedPence });
  const admin = createAdminClient();
  const base = `pi:${input.paymentIntentId}:${input.reason}`;
  // The member's adjustments, matched here exactly: a LIKE pattern would read the "_" in a Stripe id as a wildcard.
  const { data: prior, error } = await admin.from('credit_grants').select('amount_pence, source_ref').eq('user_id', input.userId).eq('kind', 'adjustment').not('source_ref', 'is', null);
  if (error) throw new Error(`clawback read failed: ${error.message}`);
  const taken = ((prior ?? []) as { amount_pence: number | string; source_ref: string }[])
    .filter((g) => g.source_ref === base || g.source_ref.startsWith(`${base}:`))
    .reduce((sum, g) => sum + Math.max(0, -num(g.amount_pence)), 0);
  const diff = Math.round(target - taken);
  if (diff > 0) {
    await grant(input.userId, 'adjustment', -diff, {
      sourceRef: taken > 0 ? `${base}:${Math.round(input.refundedPence)}` : base,
      description: input.reason === 'disputed' ? 'Starter pack disputed: credit reversed' : 'Starter pack refunded: credit reversed',
    });
  }
  if (input.reason === 'refunded') {
    await admin.from('starter_pack_purchases').update({ refunded_pence: Math.max(num(row.refunded_pence), Math.round(input.refundedPence)) }).eq('payment_intent_id', input.paymentIntentId);
  }
  await queueFunnelSync(input.userId, 'refund');
  return Math.max(0, diff);
}
