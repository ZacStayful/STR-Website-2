import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getCreditSummary } from './summary';
import { lowBalanceEmail, outOfCreditEmail, topupComingEmail } from '../email/billing';
import { shouldWarnBeforeTopup } from './topup-warning';
import { DEFAULT_TOPUP_THRESHOLD_PENCE } from './topup-floor';
import { queueFunnelSync } from '../crm/monday-funnel/queue-server';
import { maybeAutoTopup } from '../stripe/auto-topup';
import { isAdminEmail } from '../admin';
import { getBillingSettings } from './unit-costs';
import { isPackAccount } from '../lifecycle/settings';
import { starterPackStateFor } from '../starter-pack/server';
import { lowCreditDue, lowCreditMayGoAlone } from './low-credit';
import { isEnforcing } from './http';
import { noticeFor, queueLowCreditSync, sendLowCreditAlone } from './low-credit-server';

/**
 * Runs after a member's balance changed because of a debit: the 80% and £0
 * emails (once per cycle each, and only while the "Picks paused / out of
 * credit" switch is on — src/lib/notifications), Monday (queued: the
 * funnel sync writes "Hit zero" and "Low credit"), and auto top-up. Best-effort; never throws into the request that
 * triggered it.
 *
 * Batch 20, Part B: with no plan, "low" is £5 or less and the email is the
 * decision (Starter or a £10 top-up, src/lib/credit/low-credit.ts), capped:
 * at the top of the next daily email, or alone in today's daily slot when it
 * is still free once the day's daily emails have gone (08:30 UTC). A new
 * member who can still buy the starter pack is offered the pack, when low
 * and when out.
 */
/** The starter pack's words for the out-of-credit email, while this new member can still buy it. */
async function packOffer(userId: string, createdAt: string | null): Promise<{ body: string; cta: string } | null> {
  try {
    const settings = await getBillingSettings();
    if (!isPackAccount(createdAt, settings.lifecycle)) return null;
    const state = await starterPackStateFor(userId);
    return state.offer.eligible ? { body: state.copy.body, cta: state.copy.cardCta } : null;
  } catch {
    return null;
  }
}

/** Batch 21 (B46): whether this account has ever been granted credit (any positive grant). Unreadable counts as yes. */
async function everGranted(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await admin.from('credit_grants').select('id').eq('user_id', userId).gt('amount_pence', 0).limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

export async function afterDebit(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [summary, { data: p }] = await Promise.all([
      getCreditSummary(userId),
      admin.from('profiles').select('email, alert_credit, sourcing_alerts, last_low_balance_email_at, last_out_of_credit_email_at, last_topup_warning_email_at, hit_zero_at, current_period_end, auto_topup_amount_pence, auto_topup_threshold_pence, created_at, stripe_default_payment_method_id').eq('id', userId).maybeSingle(),
    ]);
    if (!p) return;
    // The switch covers the two credit warnings only. The pre-charge warning
    // below precedes a card payment and is always sent, as receipts are.
    const email = p.alert_credit === false ? null : ((p.email as string | null) ?? null);
    const paymentEmail = (p.email as string | null) ?? null;
    const now = new Date();
    // "This cycle" = since the current plan period started (or the last 30 days for free accounts).
    const cycleStart = summary.cycle?.endsAt ? new Date(new Date(summary.cycle.endsAt).getTime() - 31 * 86_400_000) : new Date(now.getTime() - 30 * 86_400_000);
    const sentThisCycle = (iso: unknown) => Boolean(iso) && new Date(String(iso)).getTime() >= cycleStart.getTime();

    if (summary.state === 'out') {
      if (p.auto_topup_amount_pence) {
        const r = await maybeAutoTopup(userId);
        if (r === 'charged') return;
      }
      // Batch 21 (B46): an account that has never held a grant has no credit to
      // have run out of (a pack-era sign-up's first metered call): no email,
      // no "Hit zero"; the quiz and Today offer the pack.
      if (!(await everGranted(admin, userId))) return;
      const patch: Record<string, unknown> = {};
      // Batch 21 (B40): "Hit zero" only while credit is enforced. In shadow mode
      // nothing is refused, so it is not a state the member is in, and Monday
      // was stamping members who were still using the site.
      const hitZeroNow = isEnforcing() && (!p.hit_zero_at || !sentThisCycle(p.hit_zero_at));
      if (hitZeroNow) patch.hit_zero_at = now.toISOString();
      // Batch 21 (D9, Q7): with no plan, the morning's daily email carries the £5
      // decision (or the pack) at its top, so an out-of-credit email of its own
      // waits until the day's daily emails have gone (08:30 UTC) rather than
      // arrive a minute after Today's 5; the next debit after that sends it.
      const emailDue = Boolean(email) && !sentThisCycle(p.last_out_of_credit_email_at) && (!summary.noPlan || lowCreditMayGoAlone(now));
      if (email && emailDue) {
        patch.last_out_of_credit_email_at = now.toISOString();
        // Batch 20: a new member who can still buy the starter pack is offered it.
        const pack = summary.noPlan ? await packOffer(userId, (p.created_at as string | null) ?? null) : null;
        void outOfCreditEmail(email, { planName: summary.noPlan ? null : (summary.cycle?.planName ?? null), pack }).catch(() => {});
      }
      if (Object.keys(patch).length) await admin.from('profiles').update(patch).eq('id', userId);
      // Batch 20: Monday's "Hit zero" follows through the funnel queue, once the stamp is written.
      if (hitZeroNow) await queueFunnelSync(userId, 'hit_zero');
      return;
    }
    if (summary.state === 'low') {
      if (p.auto_topup_amount_pence) {
        const r = await maybeAutoTopup(userId);
        if (r === 'charged') return;
      }
      if (summary.noPlan) {
        // Batch 20, Part B: the £5 decision, once a cycle.
        const settings = await getBillingSettings();
        const lastToldAt = (p.last_low_balance_email_at as string | null) ?? null;
        const due = lowCreditDue({ noPlan: true, balancePence: summary.totalPence, spendableBasePence: summary.spendableBasePence, lowCreditPence: settings.lifecycle.lowCreditPence, lastToldAt, alertsOn: true, hasEmail: true, admin: false, now });
        if (!due) return;
        await queueLowCreditSync(userId);
        if (!email || isAdminEmail(paymentEmail)) return;
        // Before the day's daily emails have gone, they carry it (the picks run and the digest read who is due):
        // sent alone now, it would take the day's one slot from that morning's deals. Batch 21 (D11, B28): a
        // member with daily picks off gets no daily email to carry it, so theirs goes alone now (the slot claim
        // still stops a second email today).
        if (p.sourcing_alerts !== false && !lowCreditMayGoAlone(now)) return;
        const notice = await noticeFor({ userId, createdAt: (p.created_at as string | null) ?? null, paymentMethodId: (p.stripe_default_payment_method_id as string | null) ?? null, balancePence: summary.totalPence, now });
        // Today's slot taken (the daily email went this morning): tomorrow's daily email carries it.
        await sendLowCreditAlone(admin, { userId, email, notice, now });
        return;
      }
      if (email && !sentThisCycle(p.last_low_balance_email_at)) {
        await admin.from('profiles').update({ last_low_balance_email_at: now.toISOString() }).eq('id', userId);
        void lowBalanceEmail(email, { remainingPence: summary.totalPence, planName: summary.cycle?.planName ?? null, topupRate: summary.rates.topup }).catch(() => {});
      }
      return;
    }
    // Healthy balance, but possibly on the way down towards an automatic
    // charge. This is the gap the plan called out: today a customer gets a
    // low-balance email and then a payment, with nothing in between saying
    // one is coming.
    //
    // It sits here rather than in the 'low' branch on purpose. By the time
    // the balance reads 'low' the charge is imminent or already happening,
    // and a warning about a payment that is about to be taken in the same
    // breath is not a warning.
    if (paymentEmail) {
      const decision = shouldWarnBeforeTopup({
        spendableBasePence: summary.spendableBasePence,
        thresholdPence: Number(p.auto_topup_threshold_pence ?? DEFAULT_TOPUP_THRESHOLD_PENCE),
        autoTopupAmountPence: p.auto_topup_amount_pence ? Number(p.auto_topup_amount_pence) : null,
        lastWarningAt: (p.last_topup_warning_email_at as string | null) ?? null,
        cycleStart,
      });
      if (decision.warn) {
        // Stamped before sending, as the other two are: a duplicate email is
        // a nuisance, and a send that succeeds without being recorded would
        // repeat on every debit.
        await admin.from('profiles').update({ last_topup_warning_email_at: now.toISOString() }).eq('id', userId);
        void topupComingEmail(paymentEmail, {
          amountPence: Number(p.auto_topup_amount_pence),
          thresholdPence: Number(p.auto_topup_threshold_pence ?? DEFAULT_TOPUP_THRESHOLD_PENCE),
          remainingPence: summary.spendableBasePence,
        }).catch(() => {});
      }
    }

    if (p.auto_topup_amount_pence) await maybeAutoTopup(userId);
  } catch (err) {
    console.error('[credit] afterDebit failed:', err);
  }
}
