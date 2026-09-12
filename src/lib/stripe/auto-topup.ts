import 'server-only';

import { createAdminClient } from '../supabase/admin';
import { getBalance } from '../credit/ledger';
import { getStripe, stripeConfigured } from './client';
import { grantTopup } from './grants';
import { cardNeedsUpdateEmail } from '../email/billing';

/**
 * Opt-in auto top-up: when a debit leaves the balance below the member's
 * threshold, charge their saved card for their chosen amount. At most one
 * attempt per 10 minutes per member; a decline switches the setting off and
 * emails them. Called from the meter after a debit (fire-and-forget).
 */
export async function maybeAutoTopup(userId: string): Promise<'charged' | 'skipped' | 'failed'> {
  if (!stripeConfigured()) return 'skipped';
  const admin = createAdminClient();
  const { data: p } = await admin
    .from('profiles')
    .select('email, stripe_customer_id, stripe_default_payment_method_id, auto_topup_amount_pence, auto_topup_threshold_pence, auto_topup_last_at')
    .eq('id', userId)
    .maybeSingle();
  if (!p || !p.auto_topup_amount_pence || !p.stripe_default_payment_method_id || !p.stripe_customer_id) return 'skipped';
  const last = p.auto_topup_last_at ? new Date(String(p.auto_topup_last_at)).getTime() : 0;
  if (Date.now() - last < 10 * 60 * 1000) return 'skipped';
  const bal = await getBalance(userId);
  if (bal.spendableBasePence >= Number(p.auto_topup_threshold_pence ?? 500)) return 'skipped';

  // Claim the slot before charging so two concurrent debits can't double-charge.
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from('profiles').update({ auto_topup_last_at: now }).eq('id', userId).or(`auto_topup_last_at.is.null,auto_topup_last_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`).select('id');
  if (!claimed || claimed.length === 0) return 'skipped';

  const amount = Number(p.auto_topup_amount_pence);
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount,
        currency: 'gbp',
        customer: String(p.stripe_customer_id),
        payment_method: String(p.stripe_default_payment_method_id),
        off_session: true,
        confirm: true,
        description: `Stayful auto top-up £${(amount / 100).toFixed(2)}`,
        metadata: { user_id: userId, kind: 'topup', amount_pence: String(amount), auto: '1' },
      },
      { idempotencyKey: `autotopup:${userId}:${now.slice(0, 16)}` },
    );
    if (pi.status !== 'succeeded') throw new Error(`payment intent ${pi.status}`);
    await grantTopup(userId, amount, `pi:${pi.id}`, { email: (p.email as string | null) ?? null });
    return 'charged';
  } catch (err) {
    console.warn('[auto-topup] charge failed; switching off:', (err as Error).message);
    await admin.from('profiles').update({ auto_topup_amount_pence: null }).eq('id', userId);
    if (p.email) await cardNeedsUpdateEmail(String(p.email)).catch(() => {});
    return 'failed';
  }
}
