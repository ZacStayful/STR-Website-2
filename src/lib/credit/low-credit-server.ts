import 'server-only';

import type { createAdminClient } from '../supabase/admin';
import { isAdminEmail } from '../admin';
import { accountStatus, type AccessProfile } from '../access';
import { getBillingSettings } from './unit-costs';
import { getPlan } from './plans';
import { planCreditFor } from './deal-pricing';
import { priceIdForPlan } from '../stripe/prices';
import { cardSummary } from '../stripe/customer';
import { isPackAccount } from '../lifecycle/settings';
import { starterPackStateFor } from '../starter-pack/server';
import { siteUrl } from '../url';
import { sendEmail, isEmailConfigured } from '../email/send';
import { renderEmail } from '../notify/render-email';
import { claimSlot, finishSend, markSending, releaseClaim } from '../notify/sends';
import { newSendToken, sendKey } from '../notify/cap';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { lowCreditDue, lowCreditMessage, type LowCreditNotice } from './low-credit';

/**
 * The £5 low-credit decision's reads and its one standalone send (Batch 20,
 * Part B; the rules and words are in ./low-credit.ts).
 *
 *   lowCreditNoticesFor   the daily runs: for the members about to get
 *                         today's daily email, whose notice is due, the
 *                         notice to put at its top. Batched reads.
 *   noticeFor             one member (after a debit).
 *   sendLowCreditAlone    the notice as the day's daily email, when the slot
 *                         is still free.
 *   markLowCreditTold     once it has gone, in either: once a cycle.
 */

type Admin = ReturnType<typeof createAdminClient>;

const ID_CHUNK = 150;
const PROFILE_COLUMNS = 'id, email, alert_credit, last_low_balance_email_at, created_at, stripe_default_payment_method_id, plan, plan_code, plan_source, reports_run, stripe_subscription_id, stripe_subscription_status, subscription_paused_from, subscription_paused_until, subscription_cancel_at';

type ProfileRow = AccessProfile & {
  id: string;
  email: string | null;
  alert_credit: boolean | null;
  last_low_balance_email_at: string | null;
  created_at: string | null;
  stripe_default_payment_method_id: string | null;
};

function noPlanOf(p: AccessProfile): boolean {
  const s = accountStatus(p);
  return s === 'free' || s === 'lapsed';
}

export interface DecisionOffer {
  starter: { code: string; name: string; pricePence: number; creditPence: number } | null;
  topupPence: number;
}

/** The two choices: Starter, when it can be bought (active, monthly, a Stripe price), and the £10 top-up (else the smallest). */
export async function decisionOffer(now: Date = new Date()): Promise<DecisionOffer> {
  const settings = await getBillingSettings();
  const presets = settings.topupPresetsPence;
  const topupPence = presets.includes(1000) ? 1000 : (presets[0] ?? 1000);
  const plan = await getPlan('starter');
  const starter = plan && plan.active && plan.interval === 'month' && priceIdForPlan(plan.code) ? { code: plan.code, name: plan.name, pricePence: plan.pricePence, creditPence: planCreditFor(plan, now, settings.dealPricing) } : null;
  return { starter, topupPence };
}

/** What the notice offers this member: the pack while they can buy it, else Starter (when it can be bought) and the £10 top-up. */
export async function noticeFor(input: { userId: string; createdAt: string | null; paymentMethodId: string | null; balancePence: number; now?: Date }): Promise<LowCreditNotice> {
  const now = input.now ?? new Date();
  const settings = await getBillingSettings();
  const offer = await decisionOffer(now);
  if (isPackAccount(input.createdAt, settings.lifecycle)) {
    const state = await starterPackStateFor(input.userId);
    if (state.offer.eligible) return { balancePence: input.balancePence, kind: 'pack', starter: null, topupPence: offer.topupPence, card: null, pack: { body: state.copy.body, cta: state.copy.cardCta } };
  }
  const card = await cardSummary(input.paymentMethodId);
  return { balancePence: input.balancePence, kind: 'decision', ...offer, card: card ? { brand: card.brand, last4: card.last4 } : null, pack: null };
}

/**
 * The daily runs: which of these members (each paying for themselves) is due
 * the notice today, and what it says. Anything unreadable (the balances
 * function before the schema is run) means no notices, never a wrong one.
 */
export async function lowCreditNoticesFor(admin: Admin, userIds: readonly string[], now: Date = new Date()): Promise<Map<string, LowCreditNotice>> {
  const out = new Map<string, LowCreditNotice>();
  if (userIds.length === 0) return out;
  const settings = await getBillingSettings();
  const lowCreditPence = settings.lifecycle.lowCreditPence;
  if (!(lowCreditPence > 0)) return out;
  const candidates: ProfileRow[] = [];
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).in('id', userIds.slice(i, i + ID_CHUNK));
    if (error) {
      console.warn('[low-credit] profiles unreadable:', error.message);
      return out;
    }
    for (const p of (data ?? []) as unknown as ProfileRow[]) {
      // Everything but the balance first, so the balances are read only for members who could be due.
      if (lowCreditDue({ noPlan: noPlanOf(p), balancePence: 0, spendableBasePence: 1, lowCreditPence, lastToldAt: p.last_low_balance_email_at, alertsOn: p.alert_credit !== false, hasEmail: Boolean(p.email), admin: isAdminEmail(p.email), now })) candidates.push(p);
    }
  }
  if (candidates.length === 0) return out;
  const balances = new Map<string, { total: number; spendable: number }>();
  for (let i = 0; i < candidates.length; i += ID_CHUNK) {
    const { data, error } = await admin.rpc('lifecycle_balances', { p: { users: candidates.slice(i, i + ID_CHUNK).map((p) => p.id) } });
    if (error) {
      console.warn('[low-credit] balances unreadable (schema behind?):', error.message);
      return out;
    }
    for (const r of (data ?? []) as { u: string; total: number | string; spendable: number | string }[]) balances.set(r.u, { total: Number(r.total) || 0, spendable: Number(r.spendable) || 0 });
  }
  for (const p of candidates) {
    const b = balances.get(p.id);
    if (!b) continue;
    if (!lowCreditDue({ noPlan: true, balancePence: b.total, spendableBasePence: b.spendable, lowCreditPence, lastToldAt: p.last_low_balance_email_at, alertsOn: true, hasEmail: true, admin: false, now })) continue;
    try {
      out.set(p.id, await noticeFor({ userId: p.id, createdAt: p.created_at, paymentMethodId: p.stripe_default_payment_method_id, balancePence: b.total, now }));
    } catch (err) {
      console.warn('[low-credit] notice not built:', err instanceof Error ? err.message : String(err));
    }
  }
  return out;
}

/** Told: nothing more this cycle. Monday hears of it through its queue. */
export async function markLowCreditTold(admin: Admin, userId: string, now: Date = new Date()): Promise<void> {
  const { error } = await admin.from('profiles').update({ last_low_balance_email_at: now.toISOString() }).eq('id', userId);
  if (error) console.error('[low-credit] told stamp failed:', error.message);
}

/**
 * The notice as the day's daily email, when nothing else has taken the slot.
 * A slot already used today leaves it for tomorrow's daily email, which
 * carries it at the top (the picks run and the digest read who is due).
 */
export async function sendLowCreditAlone(admin: Admin, input: { userId: string; email: string; notice: LowCreditNotice; now?: Date }): Promise<'sent' | 'slot_used' | 'unavailable' | 'failed' | 'not_configured'> {
  const now = input.now ?? new Date();
  if (!isEmailConfigured()) return 'not_configured';
  const claim = await claimSlot(admin, input.userId, 'low_credit', now);
  if (!claim.ok) return claim.reason === 'slot_used' ? 'slot_used' : 'unavailable';
  const base = siteUrl();
  const token = newSendToken();
  const unsubscribeUrl = `${base.replace(/\/$/, '')}/api/notify/unsubscribe/${token}`;
  const message = lowCreditMessage(input.notice, base, { label: 'Stop these emails', url: unsubscribeUrl, oneClickUrl: unsubscribeUrl });
  const summary = { lowCredit: input.notice.kind, balancePence: Math.round(input.notice.balancePence), subject: message.subject };
  if (!(await markSending(admin, claim.id, summary, token))) {
    await releaseClaim(admin, claim.id);
    return 'unavailable';
  }
  const mail = renderEmail(message);
  const res = await sendEmail({ to: input.email, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers, idempotencyKey: sendKey('daily', input.userId, claim.day) });
  await finishSend(admin, claim.id, res.sent, summary, []);
  if (!res.sent) return 'failed';
  await markLowCreditTold(admin, input.userId, now);
  return 'sent';
}

/** A member crossing into £5 or less: Monday's "Low credit" follows within ten minutes. */
export async function queueLowCreditSync(userId: string): Promise<void> {
  await queueFunnelSync(userId, 'low_credit');
}
