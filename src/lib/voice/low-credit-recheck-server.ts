import 'server-only';

/**
 * Review R3 (R3-14 / R2-24, R3-45 / R2-43): a queued low-credit call is
 * tested again just before it dials. The balance must still be at or below
 * low_credit_pence; the call's landing must still be the member's most
 * recent credit (a top-up since means the call is about credit that is
 * gone); and no slower-spender nudge may have been decided for that landing
 * (then the nudge is the notice). The rule itself is low-credit.ts; the
 * queue is queue-server.ts.
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { getBalance } from '../credit/ledger';
import { latestLanding, type GrantRow } from './low-credit';

export type LowCreditRecheck = { ok: true } | { ok: false; reason: 'topped_up' | 'nudged' };

export async function lowCreditStillDue(userId: string, triggerRef: string | null, now: Date): Promise<LowCreditRecheck> {
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const balance = await getBalance(userId).catch(() => null);
  if (!balance || balance.totalPence > settings.lifecycle.lowCreditPence) return { ok: false, reason: 'topped_up' };
  if (!triggerRef) return { ok: true };
  const since = new Date(now.getTime() - (settings.voice.lowCreditWindowDays + 31) * 86_400_000).toISOString();
  const { data: grants, error } = await admin.from('credit_grants').select('id, kind, amount_pence, source_ref, created_at').eq('user_id', userId).gt('amount_pence', 0).gte('created_at', since).order('created_at', { ascending: false }).limit(20);
  // The balance is the fact that matters; unreadable grants leave the queue-time landing standing.
  const landing = error ? null : latestLanding((grants ?? []) as GrantRow[]);
  if (landing && landing.id !== triggerRef) return { ok: false, reason: 'topped_up' };
  const { data: nudges } = await admin.from('credit_nudges').select('id').eq('user_id', userId).eq('landing_id', triggerRef).limit(1);
  if ((nudges ?? []).length > 0) return { ok: false, reason: 'nudged' };
  return { ok: true };
}
