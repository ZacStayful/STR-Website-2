import 'server-only';

import type Stripe from 'stripe';
import { createAdminClient } from '../supabase/admin';
import { getStripe } from '../stripe/client';
import { grant, getBalance } from '../credit/ledger';
import { normaliseMobile } from '../credit/abuse';
import { grantTopup } from '../stripe/grants';
import { starterPackReceiptEmail } from '../email/billing';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { forgetTodayLists } from '../today/forget-server';
import { CONSENT_VERSION, packClawbackPence, packEmailKey } from './rules';

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
  granted_at: string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function purchaseRow(piId: string): Promise<PurchaseRow | null> {
  const { data, error } = await createAdminClient().from('starter_pack_purchases').select('payment_intent_id, user_id, status, blocked_by, price_pence, credit_pence, refunded_pence, granted_at').eq('payment_intent_id', piId).maybeSingle();
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
  // A failed read must not claim with no email or number: that would skip those checks and store nothing for later claims to meet.
  const { data: profile, error: profileErr } = await admin.from('profiles').select('email, mobile, mobile_key').eq('id', userId).maybeSingle();
  if (profileErr) throw new Error(`starter pack claim: profile read failed: ${profileErr.message}`);
  const p = (profile ?? {}) as { email?: string | null; mobile?: string | null; mobile_key?: string | null };
  const card = fingerprintOf(pi);
  // Batch 21 (B30): Checkout and the saved-card path only take cards, so a pack
  // without a fingerprint is worth a loud line: its card leg of once-per-person is empty.
  if (!card) console.error(`[starter-pack] ${pi.id} has no card fingerprint; the claim cannot stop this card buying again`);
  const { data, error } = await admin.rpc('starter_pack_claim', {
    p: {
      pi: pi.id,
      user: userId,
      // Batch 21 (B21, B22): the claim's own email key, and the number the account holds, not the editable one.
      email_key: packEmailKey(p.email),
      mobile_key: p.mobile_key ?? normaliseMobile(p.mobile ?? null),
      card,
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

/** Batch 21 (B44): the money has been taken; the claim's 8-day sweep leaves a captured row alone. */
async function markCaptured(piId: string): Promise<void> {
  const { error } = await createAdminClient().from('starter_pack_purchases').update({ captured_at: new Date().toISOString() }).eq('payment_intent_id', piId).is('captured_at', null);
  if (error) console.error('[starter-pack] captured_at not stamped:', error.message);
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
    if (pi.status === 'succeeded') {
      await markCaptured(pi.id);
      return 'already';
    }
    if (pi.status !== 'requires_capture') {
      await markFailed(pi.id);
      return 'failed';
    }
    try {
      await stripe.paymentIntents.capture(pi.id, {}, { idempotencyKey: `starter_pack_capture:${pi.id}` });
      await markCaptured(pi.id);
      return 'captured';
    } catch (err) {
      // The capture may have gone through anyway (a second settle of the same
      // payment got there first, or the reply was lost): ask Stripe. Only a
      // cancelled payment is a failure; one still waiting to be captured keeps
      // its claim, and the error makes the caller try again (the webhook is
      // redelivered), so a charged member is never told they were not.
      const now = await stripe.paymentIntents.retrieve(pi.id);
      if (now.status === 'succeeded') {
        await markCaptured(pi.id);
        return 'captured';
      }
      if (now.status === 'canceled') {
        await markFailed(pi.id);
        return 'failed';
      }
      throw new Error(`starter pack ${pi.id}: capture failed (${(err as Error)?.message ?? err}); the payment is ${now.status}`);
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
 * The profile as of the grant, so a late redelivery changes nothing that has
 * happened since: bought stamped once; last_topup_at (which makes them paid
 * for early access, as any top-up does) never moved backwards; hit_zero_at
 * cleared only when they hit zero before this credit arrived.
 */
async function markProfile(userId: string, at: string): Promise<void> {
  const admin = createAdminClient();
  const writes = await Promise.all([
    admin.from('profiles').update({ starter_pack_bought_at: at }).eq('id', userId).is('starter_pack_bought_at', null),
    admin.from('profiles').update({ last_topup_at: at }).eq('id', userId).is('last_topup_at', null),
    admin.from('profiles').update({ last_topup_at: at }).eq('id', userId).lt('last_topup_at', at),
    admin.from('profiles').update({ hit_zero_at: null }).eq('id', userId).lt('hit_zero_at', at),
  ]);
  for (const w of writes) if (w.error) console.error('[starter-pack] profile update failed:', w.error.message);
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

  if (row.status === 'blocked') {
    // A repeat that was charged: the member gets what they paid for, as any top-up.
    if (price > 0) await grantTopup(userId, price, `pi:${pi.id}`, { email: input.email });
    return 'blocked';
  }
  // Batch 21 (B44): a 'failed' row whose payment succeeded was captured after
  // all (by hand, or swept before captured_at existed): it is the pack the
  // member paid for, never a plain top-up that reopens the offer.
  await markCaptured(pi.id);

  // The credit first, both grants every time: idempotent on source_ref, so a
  // redelivery completes a run that died half-way and never doubles it.
  const bonus = Math.max(0, credit - price);
  if (price > 0) await grant(userId, 'topup', price, { sourceRef: `pi:${pi.id}`, description: 'Starter pack' });
  if (bonus > 0) await grant(userId, 'welcome', bonus, { sourceRef: `pack_bonus:${pi.id}`, description: 'Starter pack bonus credit' });

  // Then the move to "granted": the one call that makes it (the route or the
  // webhook, whichever is first) sends the receipt and queues Monday.
  const nowIso = new Date().toISOString();
  const { data: moved, error: moveErr } = await admin
    .from('starter_pack_purchases')
    .update({ status: 'granted', granted_at: nowIso, amount_paid_pence: pi.amount_received ?? pi.amount })
    .eq('payment_intent_id', pi.id)
    .in('status', ['reserved', 'failed'])
    .select('payment_intent_id');
  if (moveErr) throw new Error(`starter_pack_purchases update failed: ${moveErr.message}`);
  const first = (moved?.length ?? 0) > 0;
  if (first) {
    if (input.email) {
      const bal = await getBalance(userId).catch(() => null);
      await starterPackReceiptEmail(input.email, { pricePence: price, creditPence: credit, balancePence: bal?.totalPence ?? credit }).catch(() => false);
    }
    await queueFunnelSync(userId, 'starter_pack');
    // Batch 21 (C32): the pack lifts the early-access delay; the morning's Today
    // list was chosen as a free member, so the next visit chooses again.
    await forgetTodayLists(userId);
  }

  // Every time, so a run that died before them is completed; each as of the grant.
  const grantedAt = first ? nowIso : (row.granted_at ?? (await purchaseRow(pi.id))?.granted_at ?? nowIso);
  await markProfile(userId, grantedAt);
  // A team owner's seats paused for want of credit come back now (only seats still suspended; none if the credit has gone again).
  try {
    const { reinstateSeats } = await import('../team/seats');
    await reinstateSeats({ ownerId: userId });
  } catch (err) {
    console.error('[starter-pack] seat reinstatement failed:', (err as Error)?.message ?? err);
  }
  return first ? 'granted' : 'already';
}

/**
 * A pack's payment refunded or disputed: take back the same share of its
 * credit (all of it for a full refund), whatever has been spent; the ledger
 * may go negative until the next credit repays it. Cumulative: the first
 * clawback is `pi:<id>:refunded` (the name Batch 9 and Batch 19 look for), a
 * later partial refund `pi:<id>:refunded:<total refunded>`, each only the
 * difference, read and written under the member's row lock
 * (public.starter_pack_clawback) so two refunds handled at once cannot both
 * miss the other. The pack stays used. Only for a payment that was captured:
 * the webhook never sends a released authorisation here.
 */
export async function clawbackStarterPack(input: { userId: string; paymentIntentId: string; refundedPence: number; chargedPence: number; reason: 'refunded' | 'disputed' }): Promise<number> {
  const row = await purchaseRow(input.paymentIntentId);
  if (!row) return 0;
  // Granted, or reserved (captured, its grant not run yet: it will add the full credit): the pack's credit.
  // A repeat charged anyway was a plain top-up of its price.
  const creditBase = row.status === 'granted' || row.status === 'reserved' ? num(row.credit_pence) : num(row.price_pence);
  if (creditBase <= 0) return 0;
  const target = packClawbackPence({ creditPence: creditBase, chargedPence: input.chargedPence, refundedPence: input.refundedPence });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('starter_pack_clawback', {
    p: {
      user: input.userId,
      base: `pi:${input.paymentIntentId}:${input.reason}`,
      target: Math.round(target),
      refunded: Math.round(input.refundedPence),
      description: input.reason === 'disputed' ? 'Starter pack disputed: credit reversed' : 'Starter pack refunded: credit reversed',
    },
  });
  if (error) throw new Error(`starter_pack_clawback failed: ${error.message}`);
  if (input.reason === 'refunded') {
    await admin.from('starter_pack_purchases').update({ refunded_pence: Math.max(num(row.refunded_pence), Math.round(input.refundedPence)) }).eq('payment_intent_id', input.paymentIntentId);
  }
  // Batch 21 (C17): a pack refunded in full was the member's only payment, so
  // they are a free account again for early access (last_topup_at was the
  // pack's); a member with any other top-up or a subscription keeps the tier.
  if (input.chargedPence > 0 && input.refundedPence >= input.chargedPence && row.user_id) await dropPaidTierIfNothingElse(row.user_id, `pi:${input.paymentIntentId}`);
  await queueFunnelSync(input.userId, 'refund');
  return Math.max(0, num(data));
}

/** Clears last_topup_at when the refunded payment was the account's only one: no other top-up grant and no subscription history. */
async function dropPaidTierIfNothingElse(userId: string, refundedSourceRef: string): Promise<void> {
  const admin = createAdminClient();
  const [others, profile] = await Promise.all([
    admin.from('credit_grants').select('id').eq('user_id', userId).eq('kind', 'topup').neq('source_ref', refundedSourceRef).limit(1),
    admin.from('profiles').select('subscription_started_at, stripe_subscription_id, plan_code').eq('id', userId).maybeSingle(),
  ]);
  if (others.error || profile.error) return;
  const p = (profile.data ?? {}) as { subscription_started_at?: string | null; stripe_subscription_id?: string | null; plan_code?: string | null };
  if ((others.data?.length ?? 0) > 0 || p.subscription_started_at || p.stripe_subscription_id || p.plan_code) return;
  const { error } = await admin.from('profiles').update({ last_topup_at: null }).eq('id', userId);
  if (error) console.error('[starter-pack] last_topup_at not cleared after a full refund:', error.message);
}
