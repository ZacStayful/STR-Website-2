import 'server-only';

/**
 * Batch 23, Part C: the low-credit call's trigger, run from afterDebit
 * (src/lib/credit/after-debit.ts) after the member's auto top-up has had its
 * chance. The rule is low-credit.ts; the queue and every safety rule are
 * queue-server.ts.
 *
 * The answer tells Batch 20's £5 notice what to do the same day:
 *   called: true    a low-credit call for this credit landing is queued or
 *                   placed — the call (or its missed-call text and email) is
 *                   the notice, so Batch 20's is skipped
 *   called: false   no call (not triggered, a member choice, or a safety rule
 *                   blocked it) — Batch 20's notice runs as it always has
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { getBalance } from '../credit/ledger';
import { callsEnabled } from './config';
import { latestLanding, lowCreditTriggered, spentFromLedger, type GrantRow } from './low-credit';
import { enqueueCall, placeCall } from './queue-server';
import { inOutboundHours } from './hours';

export async function maybeQueueLowCreditCall(userId: string, now: Date = new Date()): Promise<{ called: boolean }> {
  if (!callsEnabled()) return { called: false };
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  // Cheap first: calls on, an owner with no auto top-up (enqueueCall checks it all again).
  const { data: p } = await admin.from('profiles').select('si_calls, auto_topup_amount_pence').eq('id', userId).maybeSingle();
  const prof = p as { si_calls?: boolean; auto_topup_amount_pence: number | null } | null;
  if (!prof || prof.si_calls !== true || (prof.auto_topup_amount_pence ?? 0) > 0) return { called: false };

  const balance = await getBalance(userId).catch(() => null);
  if (!balance || balance.totalPence > settings.lifecycle.lowCreditPence) return { called: false };
  const since = new Date(now.getTime() - (settings.voice.lowCreditWindowDays + 31) * 86_400_000).toISOString();
  const { data: grants, error } = await admin.from('credit_grants').select('id, kind, amount_pence, source_ref, created_at').eq('user_id', userId).gt('amount_pence', 0).gte('created_at', since).order('created_at', { ascending: false }).limit(20);
  if (error) return { called: false };
  const landing = latestLanding((grants ?? []) as GrantRow[]);
  if (!landing) return { called: false };

  // Already handled for this landing? (One low-credit call per landing.)
  const { data: existing } = await admin.from('si_calls_log').select('status').eq('user_id', userId).eq('call_type', 'low_credit').eq('trigger_ref', landing.id).limit(1);
  const prior = ((existing ?? []) as { status: string }[])[0];
  if (prior) return { called: prior.status !== 'blocked' };

  const { data: ledger } = await admin.from('credit_transactions').select('kind, amount_pence').eq('user_id', userId).in('kind', ['debit', 'refund']).gte('at', landing.landedAt.toISOString()).limit(5000);
  const triggered = lowCreditTriggered({
    balancePence: balance.totalPence,
    lowCreditPence: settings.lifecycle.lowCreditPence,
    landing,
    spentSincePence: spentFromLedger((ledger ?? []) as { kind: string; amount_pence: number }[]),
    now,
    settings: settings.voice,
  });
  if (!triggered) return { called: false };

  const r = await enqueueCall({ userId, type: 'low_credit', triggerRef: landing.id, now });
  if (r.outcome === 'queued') {
    if (inOutboundHours(now, settings.voice)) void placeCall(r.call, { apply: true, now }).catch((err) => console.error('[voice] low-credit place failed:', err));
    return { called: true };
  }
  if (r.outcome === 'exists') {
    const { data: again } = await admin.from('si_calls_log').select('status').eq('user_id', userId).eq('call_type', 'low_credit').eq('trigger_ref', landing.id).limit(1);
    return { called: ((again ?? []) as { status: string }[]).some((x) => x.status !== 'blocked') };
  }
  return { called: false };
}
