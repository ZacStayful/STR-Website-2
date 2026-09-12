import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getCreditSummary } from './summary';
import { lowBalanceEmail, outOfCreditEmail } from '../email/billing';
import { flagHitZero } from '../apis/monday';
import { maybeAutoTopup } from '../stripe/auto-topup';

/**
 * Runs after a member's balance changed because of a debit: the 80% and £0
 * emails (once per cycle each), the Monday "hit zero" flag, and auto top-up.
 * Best-effort; never throws into the request that triggered it.
 */
export async function afterDebit(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [summary, { data: p }] = await Promise.all([
      getCreditSummary(userId),
      admin.from('profiles').select('email, last_low_balance_email_at, last_out_of_credit_email_at, hit_zero_at, current_period_end, auto_topup_amount_pence').eq('id', userId).maybeSingle(),
    ]);
    if (!p) return;
    const email = (p.email as string | null) ?? null;
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
        if (email) void flagHitZero(email, now.toISOString()).catch(() => {});
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
    if (p.auto_topup_amount_pence) await maybeAutoTopup(userId);
  } catch (err) {
    console.error('[credit] afterDebit failed:', err);
  }
}
