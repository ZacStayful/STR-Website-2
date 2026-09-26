import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getCreditSummary } from './summary';
import { lowBalanceEmail, outOfCreditEmail, topupComingEmail } from '../email/billing';
import { shouldWarnBeforeTopup } from './topup-warning';
import { DEFAULT_TOPUP_THRESHOLD_PENCE } from './topup-floor';
import { flagHitZero } from '../apis/monday';
import { maybeAutoTopup } from '../stripe/auto-topup';

/**
 * Runs after a member's balance changed because of a debit: the 80% and £0
 * emails (once per cycle each, and only while the "Picks paused / out of
 * credit" switch is on — src/lib/notifications), the Monday "hit zero" flag,
 * and auto top-up. Best-effort; never throws into the request that
 * triggered it.
 */
export async function afterDebit(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [summary, { data: p }] = await Promise.all([
      getCreditSummary(userId),
      admin.from('profiles').select('email, alert_credit, last_low_balance_email_at, last_out_of_credit_email_at, last_topup_warning_email_at, hit_zero_at, current_period_end, auto_topup_amount_pence, auto_topup_threshold_pence').eq('id', userId).maybeSingle(),
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
      const patch: Record<string, unknown> = {};
      if (!p.hit_zero_at || !sentThisCycle(p.hit_zero_at)) {
        patch.hit_zero_at = now.toISOString();
        if (paymentEmail) void flagHitZero(paymentEmail, now.toISOString()).catch(() => {});
      }
      if (email && !sentThisCycle(p.last_out_of_credit_email_at)) {
        patch.last_out_of_credit_email_at = now.toISOString();
        void outOfCreditEmail(email, { planName: summary.cycle?.planName ?? null }).catch(() => {});
      }
      if (Object.keys(patch).length) await admin.from('profiles').update(patch).eq('id', userId);
      return;
    }
    if (summary.state === 'low') {
      if (p.auto_topup_amount_pence) {
        const r = await maybeAutoTopup(userId);
        if (r === 'charged') return;
      }
      if (email && !sentThisCycle(p.last_low_balance_email_at)) {
        await admin.from('profiles').update({ last_low_balance_email_at: now.toISOString() }).eq('id', userId);
        void lowBalanceEmail(email, { remainingPence: summary.totalPence, planName: summary.cycle?.planName ?? null }).catch(() => {});
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
