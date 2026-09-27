import 'server-only';

/**
 * Charges one day of daily deals: billing_settings.todays_5_daily_pence to
 * the account that pays for the member (a team member's owner), once per
 * member per UTC day, and only for an email Resend accepted. Called by the
 * 07:00 picks passes (Today's 5 with a pick) and the 08:10 digest (without
 * one), from new_pricing_from (src/lib/listing/daily-deals.ts).
 *
 * The daily_deal_charges row goes in BEFORE the debit, keyed (user_id, day):
 * a second pass, the digest or a retry finds it and charges nothing. Its
 * charged_base_pence and transaction_id are written only after the debit has
 * gone through, so the record never claims a charge the ledger does not have.
 * Admins are never charged; the caller does not call for them.
 */
import type { createAdminClient } from '../supabase/admin';
import { debit } from '../credit/ledger';
import { afterDebit } from '../credit/after-debit';

type Admin = ReturnType<typeof createAdminClient>;

export interface DailyCharge {
  charged: boolean;
  transactionId: number | null;
  /** already_charged: the day was paid for already. guard_failed: the guard row could not be written (schema behind?), so nothing was charged. */
  reason?: 'already_charged' | 'guard_failed' | 'debit_failed';
}

export async function chargeDailyDeals(admin: Admin, input: { userId: string; payerId: string; memberId: string | null; day: string; pence: number; run: 'picks' | 'digest'; sendRef: string | null }): Promise<DailyCharge> {
  if (input.pence <= 0) return { charged: false, transactionId: null };
  const { data: row, error } = await admin
    .from('daily_deal_charges')
    .insert({ user_id: input.userId, day: input.day, payer_id: input.payerId, run: input.run, send_ref: input.sendRef })
    .select('id')
    .single();
  if (error?.code === '23505') return { charged: false, transactionId: null, reason: 'already_charged' };
  if (error || !row?.id) {
    console.error('[daily-deals] charge guard insert failed (schema.sql not run?); not charged:', error?.message);
    return { charged: false, transactionId: null, reason: 'guard_failed' };
  }
  const dayLabel = new Date(`${input.day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  let transactionId: number | null = null;
  try {
    // The email has gone: allowNegative covers only the race between the
    // balance check before the send and this debit.
    transactionId = await debit(input.payerId, input.pence, {
      allowNegative: true,
      meta: { action: 'todays_5', action_id: String(row.id), provider: 'marketplace', unit: 'todays_5', quantity: 1, unit_cost_pence: 0, markup: 1, raw_cost_pence: 0, description: `Daily deals: Today's 5, ${dayLabel}`, ...(input.memberId ? { member_id: input.memberId } : {}) },
    });
  } catch (err) {
    console.error('[daily-deals] debit failed; the day stays uncharged:', (err as Error)?.message ?? err);
    return { charged: false, transactionId: null, reason: 'debit_failed' };
  }
  const { error: upErr } = await admin.from('daily_deal_charges').update({ charged_base_pence: input.pence, transaction_id: transactionId }).eq('id', row.id);
  if (upErr) console.error('[daily-deals] charge record update failed:', upErr.message);
  void afterDebit(input.payerId).catch(() => {});
  return { charged: true, transactionId };
}
